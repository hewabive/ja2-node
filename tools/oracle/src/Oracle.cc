// Links against Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Written for ja2-node as a native oracle harness, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/PathAI.cc FindBestPath, PlotPath; src/game/Tactical/LOS.cc LineOfSightTest,
// @src SoldierToSoldierLineOfSightTest; src/game/TileEngine/WorldDef.cc LoadWorld, gubWorldMovementCosts
#include "Oracle.h"

#include "Animation_Control.h"
#include "Animation_Data.h"
#include "Init.h"
#include "Isometric_Utils.h"
#include "LOS.h"
#include "Map_Information.h"
#include "Logger.h"
#include "Overhead.h"
#include "Overhead_Types.h"
#include "PathAI.h"
#include "SaveLoadGame.h"
#include "ScreenIDs.h"
#include "Soldier_Add.h"
#include "Soldier_Control.h"
#include "Soldier_Create.h"
#include "StrategicMap.h"
#include "WorldDef.h"

#include <string_theory/string>

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <exception>
#include <fstream>
#include <map>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

INT32 OracleLineOfSightTest(GridNo start_pos, FLOAT dStartZ, GridNo end_pos, FLOAT dEndZ, UINT8 ubTileSightLimit, UINT8 ubTreeSightReduction, INT8 bAware, INT8 bCamouflage, BOOLEAN fSmell, INT16* psWindowGridNo);
UINT8 OracleTreeSightReduction(UINT8 ubEndHeight);

namespace {

constexpr char const* SCRIPT_ENV = "JA2_ORACLE";
constexpr char const* OUTPUT_ENV = "JA2_ORACLE_OUT";
constexpr long long DEFAULT_TILE_SIGHT_LIMIT = 255;
constexpr int PIXELS_PER_HEIGHT_UNIT_DIVISOR = MAX_STRUCTURE_HEIGHT;
constexpr std::uint32_t FNV_OFFSET_BASIS = 2166136261u;
constexpr std::uint32_t FNV_PRIME = 16777619u;
constexpr char const BASE64_ALPHABET[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

std::FILE* gOutput = stdout;

struct Command
{
	int line;
	std::string name;
	std::map<std::string, std::string> args;
};

std::string Escape(std::string const& raw)
{
	std::string out;
	for (char const ch : raw)
	{
		switch (ch)
		{
			case '"':  out += "\\\""; break;
			case '\\': out += "\\\\"; break;
			case '\n': out += "\\n";  break;
			case '\t': out += "\\t";  break;
			default:
				if (static_cast<unsigned char>(ch) < 0x20)
				{
					char buf[8];
					std::snprintf(buf, sizeof(buf), "\\u%04x", ch);
					out += buf;
				}
				else
				{
					out += ch;
				}
		}
	}
	return out;
}

class Json
{
public:
	Json& num(char const* key, long long value) { return raw(key, std::to_string(value)); }

	Json& real(char const* key, double value)
	{
		char buf[64];
		std::snprintf(buf, sizeof(buf), "%.17g", value);
		return raw(key, buf);
	}

	Json& str(char const* key, std::string const& value) { return raw(key, "\"" + Escape(value) + "\""); }

	Json& flag(char const* key, bool value) { return raw(key, value ? "true" : "false"); }

	Json& nums(char const* key, std::vector<long long> const& values)
	{
		std::string list = "[";
		for (size_t i = 0; i < values.size(); ++i)
		{
			if (i) list += ",";
			list += std::to_string(values[i]);
		}
		return raw(key, list + "]");
	}

	Json& raw(char const* key, std::string const& value)
	{
		if (!body_.empty()) body_ += ",";
		body_ += "\"" + Escape(key) + "\":" + value;
		return *this;
	}

	std::string text() const { return "{" + body_ + "}"; }

private:
	std::string body_;
};

void Emit(Json const& json)
{
	std::string const line = json.text() + "\n";
	std::fwrite(line.data(), 1, line.size(), gOutput);
	std::fflush(gOutput);
}

std::map<std::string, UINT16> const MOVE_MODES{
	{"walk", WALKING}, {"run", RUNNING}, {"swat", SWATTING}, {"crawl", CRAWLING},
};

std::map<std::string, UINT16> const STANCES{
	{"stand", STANDING}, {"crouch", CROUCHING}, {"prone", PRONE},
};

std::map<std::string, INT8> const TEAMS{
	{"player", OUR_TEAM}, {"enemy", ENEMY_TEAM}, {"creature", CREATURE_TEAM}, {"militia", MILITIA_TEAM}, {"civ", CIV_TEAM},
};

std::map<std::string, INT8> const BODIES{
	{"regmale", REGMALE}, {"bigmale", BIGMALE}, {"stockymale", STOCKYMALE}, {"regfemale", REGFEMALE},
};

std::map<UINT8, std::string> const HEIGHT_NAMES{
	{ANIM_STAND, "stand"}, {ANIM_CROUCH, "crouch"}, {ANIM_PRONE, "prone"},
};

bool Has(Command const& c, std::string const& key)
{
	return c.args.count(key) != 0;
}

std::string Text(Command const& c, std::string const& key, std::string const& fallback)
{
	auto const it = c.args.find(key);
	return it == c.args.end() ? fallback : it->second;
}

long long ParseInteger(std::string const& key, std::string const& value)
{
	size_t used = 0;
	long long result = 0;
	try
	{
		result = std::stoll(value, &used, 0);
	}
	catch (std::exception const&)
	{
		used = 0;
	}
	if (used == 0 || used != value.size()) throw std::runtime_error("argument " + key + " is not an integer: " + value);
	return result;
}

long long Integer(Command const& c, std::string const& key, long long fallback)
{
	return Has(c, key) ? ParseInteger(key, c.args.at(key)) : fallback;
}

long long Required(Command const& c, std::string const& key)
{
	if (!Has(c, key)) throw std::runtime_error("missing argument " + key);
	return ParseInteger(key, c.args.at(key));
}

template<typename T>
T Lookup(std::map<std::string, T> const& table, Command const& c, std::string const& key, std::string const& fallback)
{
	std::string const name = Text(c, key, fallback);
	auto const it = table.find(name);
	if (it == table.end()) throw std::runtime_error("unknown value for " + key + ": " + name);
	return it->second;
}

GridNo GridArgument(Command const& c, std::string const& key)
{
	long long const g = Required(c, key);
	if (g < 0 || g >= WORLD_MAX) throw std::runtime_error("grid number out of range for " + key + ": " + std::to_string(g));
	return static_cast<GridNo>(g);
}

std::vector<Command> ParseScript(std::string const& path)
{
	std::ifstream in(path);
	if (!in) throw std::runtime_error("cannot open oracle script " + path);
	std::vector<Command> commands;
	std::string line;
	int number = 0;
	while (std::getline(in, line))
	{
		++number;
		auto const hash = line.find('#');
		if (hash != std::string::npos) line.erase(hash);
		std::istringstream tokens(line);
		Command command{number, {}, {}};
		if (!(tokens >> command.name)) continue;
		std::string token;
		int positional = 0;
		while (tokens >> token)
		{
			auto const eq = token.find('=');
			if (eq == std::string::npos)
			{
				command.args["_" + std::to_string(positional++)] = token;
			}
			else
			{
				command.args[token.substr(0, eq)] = token.substr(eq + 1);
			}
		}
		commands.push_back(command);
	}
	return commands;
}

std::string StanceName(SOLDIERTYPE const& s)
{
	auto const it = HEIGHT_NAMES.find(gAnimControl[s.usAnimState].ubEndHeight);
	return it == HEIGHT_NAMES.end() ? "unknown" : it->second;
}

std::string Describe(SOLDIERTYPE const& s)
{
	return Json{}
		.num("id", s.ubID)
		.num("team", s.bTeam)
		.num("profile", s.ubProfile)
		.num("body", s.ubBodyType)
		.num("gridNo", s.sGridNo)
		.num("level", s.bLevel)
		.str("stance", StanceName(s))
		.num("animState", s.usAnimState)
		.num("terrain", s.bOverTerrainType)
		.text();
}

class ProbeSoldier
{
public:
	explicit ProbeSoldier(SOLDIERTYPE& existing) : soldier_(&existing), owned_(false) {}

	ProbeSoldier(GridNo gridNo, INT8 level, UINT16 stance, INT8 team, INT8 body, INT8 direction) : owned_(true)
	{
		SOLDIERCREATE_STRUCT c{};
		c.ubProfile        = NO_PROFILE;
		c.sSector          = gWorldSector;
		c.bTeam            = team;
		c.bBodyType        = body;
		c.bDirection       = direction;
		c.sInsertionGridNo = gridNo;
		c.fOnRoof          = level > 0;
		RandomizeNewSoldierStats(&c);
		soldier_ = TacticalCreateSoldier(c);
		if (!soldier_) throw std::runtime_error("TacticalCreateSoldier failed");
		AddSoldierToSectorNoCalculateDirection(soldier_);
		if (soldier_->sGridNo != gridNo) EVENT_SetSoldierPosition(soldier_, gridNo, SSP_NONE);
		if (stance != STANDING) EVENT_InitNewSoldierAnim(soldier_, stance, 0, TRUE);
	}

	ProbeSoldier(ProbeSoldier const&) = delete;
	ProbeSoldier& operator=(ProbeSoldier const&) = delete;

	~ProbeSoldier()
	{
		if (owned_ && soldier_) TacticalRemoveSoldier(*soldier_);
	}

	SOLDIERTYPE& get() const { return *soldier_; }

private:
	SOLDIERTYPE* soldier_{};
	bool owned_;
};

SOLDIERTYPE& ExistingSoldier(long long id)
{
	if (id < 0 || id >= MAX_NUM_SOLDIERS) throw std::runtime_error("soldier id out of range: " + std::to_string(id));
	SOLDIERTYPE& s = GetMan(static_cast<UINT>(id));
	if (!s.bActive || !s.bInSector) throw std::runtime_error("soldier is not active in the loaded sector: " + std::to_string(id));
	return s;
}

struct SoldierKeys
{
	char const* id;
	char const* gridNo;
	char const* level;
	char const* stance;
	char const* team;
	char const* body;
	char const* direction;
	char const* defaultTeam;
};

SoldierKeys const PATH_SOLDIER{"who", "from", "level", "stance", "team", "body", "dir", "enemy"};
SoldierKeys const LOS_VIEWER{"viewer", "from", "level", "stance", "team", "body", "dir", "enemy"};
SoldierKeys const LOS_TARGET{"target", "to", "toLevel", "toStance", "toTeam", "toBody", "toDir", "player"};

std::unique_ptr<ProbeSoldier> MakeSoldier(Command const& c, SoldierKeys const& k)
{
	if (Has(c, k.id)) return std::make_unique<ProbeSoldier>(ExistingSoldier(Required(c, k.id)));
	return std::make_unique<ProbeSoldier>(
		GridArgument(c, k.gridNo),
		static_cast<INT8>(Integer(c, k.level, 0)),
		Lookup(STANCES, c, k.stance, "stand"),
		Lookup(TEAMS, c, k.team, k.defaultTeam),
		Lookup(BODIES, c, k.body, "regmale"),
		static_cast<INT8>(Integer(c, k.direction, SOUTH)));
}

std::string SoldierList()
{
	std::string list = "[";
	bool first = true;
	FOR_EACH_SOLDIER(s)
	{
		if (!s->bInSector) continue;
		if (!first) list += ",";
		list += Describe(*s);
		first = false;
	}
	return list + "]";
}

void LoadSector(Command const& c)
{
	std::string const name = Text(c, "_0", Text(c, "sector", ""));
	if (name.empty()) throw std::runtime_error("sector needs a name such as A9");
	SGPSector const sector = SGPSector::FromShortString(ST::string(name), static_cast<INT8>(Integer(c, "z", 0)));
	if (!sector.IsValid()) throw std::runtime_error("invalid sector " + name);
	gWorldSector = sector;
	ST::string const map = Has(c, "map") ? ST::string(Text(c, "map", "")) : GetMapFileName(sector, FALSE);
	LoadWorld(map);
	Emit(Json{}
		.str("probe", "sector")
		.str("sector", sector.AsShortString().to_std_string())
		.num("z", sector.z)
		.str("map", map.to_std_string())
		.raw("soldiers", SoldierList()));
}

void LoadSave(Command const& c)
{
	std::string const name = Text(c, "_0", Text(c, "name", ""));
	if (name.empty()) throw std::runtime_error("save needs a name such as SaveGame01");
	LoadSavedGame(ST::string(name));
	Emit(Json{}
		.str("probe", "save")
		.str("name", name)
		.str("sector", gWorldSector.AsShortString().to_std_string())
		.num("z", gWorldSector.z)
		.flag("worldLoaded", gfWorldLoaded)
		.raw("soldiers", SoldierList()));
}

void ListSoldiers(Command const&)
{
	Emit(Json{}.str("probe", "soldiers").raw("soldiers", SoldierList()));
}

std::string Base64(std::uint8_t const* data, size_t size)
{
	std::string out;
	out.reserve((size + 2) / 3 * 4);
	for (size_t i = 0; i < size; i += 3)
	{
		std::uint32_t const b0 = data[i];
		std::uint32_t const b1 = i + 1 < size ? data[i + 1] : 0;
		std::uint32_t const b2 = i + 2 < size ? data[i + 2] : 0;
		std::uint32_t const triple = (b0 << 16) | (b1 << 8) | b2;
		out += BASE64_ALPHABET[(triple >> 18) & 0x3F];
		out += BASE64_ALPHABET[(triple >> 12) & 0x3F];
		out += i + 1 < size ? BASE64_ALPHABET[(triple >> 6) & 0x3F] : '=';
		out += i + 2 < size ? BASE64_ALPHABET[triple & 0x3F] : '=';
	}
	return out;
}

std::uint32_t Fnv1a(std::uint8_t const* data, size_t size)
{
	std::uint32_t hash = FNV_OFFSET_BASIS;
	for (size_t i = 0; i < size; ++i)
	{
		hash ^= data[i];
		hash *= FNV_PRIME;
	}
	return hash;
}

void DumpMovementCosts(Command const& c)
{
	if (!gfWorldLoaded) throw std::runtime_error("no world loaded");
	auto const* bytes = reinterpret_cast<std::uint8_t const*>(gubWorldMovementCosts);
	size_t const size = sizeof(gubWorldMovementCosts);
	std::map<int, long long> histogram;
	for (size_t i = 0; i < size; ++i) ++histogram[bytes[i]];
	Json counts;
	for (auto const& [value, count] : histogram) counts.num(std::to_string(value).c_str(), count);
	char hash[16];
	std::snprintf(hash, sizeof(hash), "%08x", Fnv1a(bytes, size));
	Json json;
	json.str("probe", "costs")
		.str("sector", gWorldSector.AsShortString().to_std_string())
		.str("layout", "u8[gridNo][direction][level]")
		.nums("shape", {WORLD_MAX, MAXDIR, 2})
		.str("fnv1a32", hash)
		.raw("histogram", counts.text());
	if (Text(c, "format", "base64") == "base64") json.str("base64", Base64(bytes, size));
	Emit(json);
}

void ProbePath(Command const& c)
{
	if (!gfWorldLoaded) throw std::runtime_error("no world loaded");
	GridNo const destination = GridArgument(c, "to");
	std::string const modeName = Text(c, "mode", "walk");
	UINT16 const mode = Lookup(MOVE_MODES, c, "mode", "walk");
	UINT8 const flags = static_cast<UINT8>(Integer(c, "flags", 0));
	bool const estimate = Integer(c, "estimate", 0) != 0;
	std::unique_ptr<ProbeSoldier> const probe = MakeSoldier(c, PATH_SOLDIER);
	SOLDIERTYPE& s = probe->get();
	INT8 const level = static_cast<INT8>(Integer(c, "toLevel", s.bLevel));

	gfEstimatePath = estimate;
	INT32 const length = FindBestPath(&s, destination, level, mode, NO_COPYROUTE, flags);
	std::vector<long long> directions;
	std::vector<long long> gridNos;
	INT16 g = s.sGridNo;
	for (INT32 i = 0; i < length; ++i)
	{
		UINT8 const dir = guiPathingData[i];
		directions.push_back(dir);
		g = NewGridNo(g, DirectionInc(dir));
		gridNos.push_back(g);
	}
	INT16 const apCost = PlotPath(&s, destination, NO_COPYROUTE, NO_PLOT, mode, 0);
	gfEstimatePath = FALSE;

	Emit(Json{}
		.str("probe", "path")
		.num("line", c.line)
		.num("from", s.sGridNo)
		.num("to", destination)
		.num("toLevel", level)
		.str("mode", modeName)
		.num("flags", flags)
		.flag("estimate", estimate)
		.raw("soldier", Describe(s))
		.num("length", length)
		.nums("directions", directions)
		.nums("gridNos", gridNos)
		.num("apCost", apCost));
}

double EyeZ(GridNo g, INT8 level, UINT16 stance)
{
	double z = 0;
	switch (gAnimControl[stance].ubEndHeight)
	{
		case ANIM_STAND:  z = STANDING_LOS_POS; break;
		case ANIM_CROUCH: z = CROUCHED_LOS_POS; break;
		case ANIM_PRONE:  z = PRONE_LOS_POS;    break;
	}
	if (level > 0) z += WALL_HEIGHT_UNITS;
	return z + gpWorldLevelData[g].sHeight * HEIGHT_UNITS / PIXELS_PER_HEIGHT_UNIT_DIVISOR;
}

void ProbeLineOfSight(Command const& c)
{
	if (!gfWorldLoaded) throw std::runtime_error("no world loaded");
	UINT8 const tileLimit = static_cast<UINT8>(Integer(c, "tileLimit", DEFAULT_TILE_SIGHT_LIMIT));
	INT8 const aware = static_cast<INT8>(Integer(c, "aware", 1));
	bool const withSoldiers = Integer(c, "soldiers", 1) != 0;

	Json json;
	json.str("probe", "los").num("line", c.line).num("tileLimit", tileLimit).num("aware", aware);

	if (!Has(c, "viewer") && !Has(c, "target"))
	{
		GridNo const from = GridArgument(c, "from");
		GridNo const to = GridArgument(c, "to");
		INT8 const fromLevel = static_cast<INT8>(Integer(c, "level", 0));
		INT8 const toLevel = static_cast<INT8>(Integer(c, "toLevel", 0));
		UINT16 const fromStance = Lookup(STANCES, c, "stance", "stand");
		UINT16 const toStance = Lookup(STANCES, c, "toStance", "stand");
		double const fromZ = EyeZ(from, fromLevel, fromStance);
		double const toZ = EyeZ(to, toLevel, toStance);
		UINT8 const tree = OracleTreeSightReduction(gAnimControl[toStance].ubEndHeight);
		INT32 const los = OracleLineOfSightTest(from, static_cast<FLOAT>(fromZ), to, static_cast<FLOAT>(toZ), tileLimit, tree, aware, 0, FALSE, nullptr);
		json.num("from", from).num("level", fromLevel).str("stance", Text(c, "stance", "stand"))
			.num("to", to).num("toLevel", toLevel).str("toStance", Text(c, "toStance", "stand"))
			.real("fromZ", fromZ).real("toZ", toZ).num("treeReduction", tree)
			.num("lineOfSight", los);
	}

	if (withSoldiers)
	{
		std::unique_ptr<ProbeSoldier> const viewer = MakeSoldier(c, LOS_VIEWER);
		std::unique_ptr<ProbeSoldier> const target = MakeSoldier(c, LOS_TARGET);
		INT32 const soldierLos = SoldierToSoldierLineOfSightTest(&viewer->get(), &target->get(), tileLimit, aware);
		json.raw("viewer", Describe(viewer->get()))
			.raw("target", Describe(target->get()))
			.num("soldierToSoldier", soldierLos);
	}
	Emit(json);
}

void Dispatch(Command const& c)
{
	if (c.name == "sector")   return LoadSector(c);
	if (c.name == "save")     return LoadSave(c);
	if (c.name == "soldiers") return ListSoldiers(c);
	if (c.name == "costs")    return DumpMovementCosts(c);
	if (c.name == "path")     return ProbePath(c);
	if (c.name == "los")      return ProbeLineOfSight(c);
	throw std::runtime_error("unknown command " + c.name);
}

void OpenOutput()
{
	char const* const path = std::getenv(OUTPUT_ENV);
	if (!path || !*path) return;
	std::FILE* const file = std::fopen(path, "w");
	if (!file) throw std::runtime_error(std::string("cannot open ") + OUTPUT_ENV + " file " + path);
	gOutput = file;
}

void CloseOutput()
{
	if (gOutput != stdout) std::fclose(gOutput);
	gOutput = stdout;
}

}

bool Oracle_IsRequested()
{
	char const* const script = std::getenv(SCRIPT_ENV);
	return script && *script;
}

void Oracle_ConfigureLogging()
{
	Logger_setLevel(LogLevel::Warn);
}

int Oracle_Run()
{
	int failures = 0;
	size_t total = 0;
	try
	{
		OpenOutput();
		std::vector<Command> const commands = ParseScript(std::getenv(SCRIPT_ENV));
		total = commands.size();
		if (InitializeJA2() == ERROR_SCREEN) throw std::runtime_error("InitializeJA2 failed");
		for (Command const& c : commands)
		{
			try
			{
				Dispatch(c);
			}
			catch (std::exception const& e)
			{
				++failures;
				Emit(Json{}.str("probe", c.name).num("line", c.line).str("error", e.what()));
			}
		}
	}
	catch (std::exception const& e)
	{
		++failures;
		Emit(Json{}.str("probe", "oracle").str("error", e.what()));
	}
	Emit(Json{}.str("probe", "end").num("commands", static_cast<long long>(total)).num("failures", failures));
	CloseOutput();
	return failures == 0 ? EXIT_SUCCESS : EXIT_FAILURE;
}
