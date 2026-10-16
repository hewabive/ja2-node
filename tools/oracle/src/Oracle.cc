// Links against Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Written for ja2-node as a native oracle harness, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/PathAI.cc FindBestPath, PlotPath; src/game/Tactical/LOS.cc LineOfSightTest,
// @src SoldierToSoldierLineOfSightTest; src/game/TileEngine/WorldDef.cc LoadWorld, gubWorldMovementCosts
// @src src/game/Tactical/Weapons.cc CalcChanceToHitGun; src/game/Tactical/Points.cc CalcTotalAPsToAttack;
// @src src/game/Tactical/UI_Cursors.cc; src/game/TacticalAI/Attacks.cc CalcBestShot; src/game/TacticalAI/DecideAction.cc
#include "Oracle.h"

#include "AIInternals.h"
#include "Animation_Control.h"
#include "Animation_Data.h"
#include "ContentManager.h"
#include "GameInstance.h"
#include "Game_Clock.h"
#include "Init.h"
#include "ItemModel.h"
#include "Items.h"
#include "Isometric_Utils.h"
#include "LOS.h"
#include "Lighting.h"
#include "OppList.h"
#include "Map_Information.h"
#include "Overhead.h"
#include "Overhead_Types.h"
#include "PathAI.h"
#include "Points.h"
#include "Random.h"
#include "SaveLoadGame.h"
#include "ScreenIDs.h"
#include "SkillCheck.h"
#include "Soldier_Add.h"
#include "Soldier_Control.h"
#include "Soldier_Create.h"
#include "Soldier_Profile.h"
#include "StrategicMap.h"
#include "Weapons.h"
#include "WorldDef.h"
#include "WorldMan.h"

#include <string_theory/string>

#include <array>
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

#include <unistd.h>

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
int gStdoutFd = -1;

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

	Json& strs(char const* key, std::vector<std::string> const& values)
	{
		std::string list = "[";
		for (size_t i = 0; i < values.size(); ++i)
		{
			if (i) list += ",";
			list += "\"" + Escape(values[i]) + "\"";
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

std::string JsonArray(std::vector<std::string> const& items)
{
	std::string list = "[";
	for (size_t i = 0; i < items.size(); ++i)
	{
		if (i) list += ",";
		list += items[i];
	}
	return list + "]";
}

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

std::map<std::string, UINT8> const AIM_LOCATIONS{
	{"head", AIM_SHOT_HEAD}, {"torso", AIM_SHOT_TORSO}, {"legs", AIM_SHOT_LEGS},
};

constexpr char const* DEFAULT_AIMS = "0,1,2,3,4";
constexpr int PERCENT = 100;

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

std::string NullableId(SOLDIERTYPE const* s)
{
	return s ? std::to_string(s->ubID) : "null";
}

bool IsGun(UINT16 item)
{
	return GCM->getItem(item)->getItemClass() == IC_GUN;
}

std::string DescribeObject(int slot, OBJECTTYPE const& o)
{
	Json json;
	json.num("slot", slot).num("item", o.usItem).num("count", o.ubNumberOfObjects).num("status", o.bStatus[0]);
	if (IsGun(o.usItem))
	{
		json.num("gunAmmo", o.ubGunShotsLeft).num("ammoItem", o.usGunAmmoItem).num("ammoType", o.ubGunAmmoType);
	}
	std::vector<std::string> attachments;
	for (int i = 0; i < MAX_ATTACHMENTS; ++i)
	{
		if (o.usAttachItem[i] == NOTHING) continue;
		attachments.push_back(Json{}.num("item", o.usAttachItem[i]).num("status", o.bAttachStatus[i]).text());
	}
	if (!attachments.empty()) json.raw("attachments", JsonArray(attachments));
	return json.text();
}

std::string DescribeInventory(SOLDIERTYPE const& s)
{
	std::vector<std::string> objects;
	for (int slot = 0; slot < NUM_INV_SLOTS; ++slot)
	{
		if (s.inv[slot].usItem != NOTHING) objects.push_back(DescribeObject(slot, s.inv[slot]));
	}
	return JsonArray(objects);
}

std::string DescribeStats(SOLDIERTYPE const& s)
{
	return Json{}
		.num("agility", s.bAgility)
		.num("dexterity", s.bDexterity)
		.num("strength", s.bStrength)
		.num("wisdom", s.bWisdom)
		.num("leadership", s.bLeadership)
		.num("marksmanship", s.bMarksmanship)
		.num("mechanical", s.bMechanical)
		.num("explosive", s.bExplosive)
		.num("medical", s.bMedical)
		.num("expLevel", s.bExpLevel)
		.text();
}

std::string DescribeEffectiveStats(SOLDIERTYPE const& s)
{
	return Json{}
		.num("marksmanship", EffectiveMarksmanship(&s))
		.num("dexterity", EffectiveDexterity(&s))
		.num("agility", EffectiveAgility(&s))
		.num("wisdom", EffectiveWisdom(&s))
		.num("expLevel", EffectiveExpLevel(&s))
		.text();
}

std::string DescribeAttackState(SOLDIERTYPE const& s)
{
	return Json{}
		.num("weapon", s.usAttackingWeapon)
		.num("hand", s.ubAttackingHand)
		.num("weaponMode", s.bWeaponMode)
		.num("doBurst", s.bDoBurst)
		.num("aimTime", s.bAimTime)
		.num("shownAimTime", s.bShownAimTime)
		.num("aimShotLocation", s.bAimShotLocation)
		.num("targetLevel", s.bTargetLevel)
		.num("targetCubeLevel", s.bTargetCubeLevel)
		.flag("dontChargeReadyAPs", s.fDontChargeReadyAPs)
		.raw("ctgtTarget", NullableId(s.CTGTTarget))
		.text();
}

INT8 Personality(SOLDIERTYPE const& s)
{
	return s.ubProfile == NO_PROFILE ? 0 : gMercProfiles[s.ubProfile].bPersonalityTrait;
}

std::string DescribeDetail(SOLDIERTYPE const& s)
{
	std::vector<long long> const oppList(std::begin(s.bOppList), std::end(s.bOppList));
	return Json{}
		.num("id", s.ubID)
		.str("name", s.name.to_std_string())
		.num("team", s.bTeam)
		.num("side", static_cast<long long>(s.bSide))
		.num("profile", s.ubProfile)
		.num("body", s.ubBodyType)
		.num("soldierClass", s.ubSoldierClass)
		.num("gridNo", s.sGridNo)
		.num("level", s.bLevel)
		.real("x", s.dXPos)
		.real("y", s.dYPos)
		.num("direction", s.bDirection)
		.num("desiredDirection", s.bDesiredDirection)
		.num("animState", s.usAnimState)
		.num("aniCode", s.usAniCode)
		.num("aniFrame", s.usAniFrame)
		.str("stance", StanceName(s))
		.num("terrain", s.bOverTerrainType)
		.num("life", s.bLife)
		.num("lifeMax", s.bLifeMax)
		.num("breath", s.bBreath)
		.num("breathMax", s.bBreathMax)
		.num("breathRed", s.sBreathRed)
		.num("bleeding", s.bBleeding)
		.num("shock", s.bShock)
		.num("ap", s.bActionPoints)
		.num("initialAp", s.bInitialActionPoints)
		.num("apPerTurn", CalcActionPoints(&s))
		.num("morale", s.bMorale)
		.num("aiMorale", s.bAIMorale)
		.num("alert", s.bAlertStatus)
		.num("orders", s.bOrders)
		.num("attitude", s.bAttitude)
		.num("visible", s.bVisible)
		.num("statusFlags", s.uiStatusFlags)
		.flag("collapsed", s.bCollapsed)
		.flag("breathCollapsed", s.bBreathCollapsed)
		.flag("noAPToFinishMove", s.fNoAPToFinishMove)
		.num("lastTarget", s.sLastTarget)
		.num("tilesMoved", s.bTilesMoved)
		.num("serviceCount", s.ubServiceCount)
		.raw("attack", DescribeAttackState(s))
		.raw("stats", DescribeStats(s))
		.raw("effective", DescribeEffectiveStats(s))
		.nums("skillTraits", {s.ubSkillTrait1, s.ubSkillTrait2})
		.num("personality", Personality(s))
		.nums("oppList", oppList)
		.raw("inventory", DescribeInventory(s))
		.text();
}

void SetStanceImmediately(SOLDIERTYPE& s, UINT16 stance)
{
	UINT32 const savedFlags = gTacticalStatus.uiFlags;
	gTacticalStatus.uiFlags |= LOADING_SAVED_GAME;
	EVENT_InitNewSoldierAnim(&s, stance, 0, TRUE);
	gTacticalStatus.uiFlags = savedFlags;
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
		if (stance != STANDING) SetStanceImmediately(*soldier_, stance);
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

std::string SoldierList(bool detail = false)
{
	std::vector<std::string> soldiers;
	FOR_EACH_SOLDIER(s)
	{
		if (!s->bInSector) continue;
		soldiers.push_back(detail ? DescribeDetail(*s) : Describe(*s));
	}
	return JsonArray(soldiers);
}

std::string DescribeTacticalStatus()
{
	return Json{}
		.num("flags", gTacticalStatus.uiFlags)
		.num("currentTeam", gTacticalStatus.ubCurrentTeam)
		.flag("inCombat", (gTacticalStatus.uiFlags & INCOMBAT) != 0)
		.num("attackBusy", gTacticalStatus.ubAttackBusyCount)
		.flag("interruptOccurred", gTacticalStatus.fInterruptOccurred)
		.text();
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
		.raw("tactical", DescribeTacticalStatus())
		.num("preRandomIndex", guiPreRandomIndex)
		.num("worldSeconds", GetWorldTotalSeconds())
		.raw("soldiers", SoldierList()));
}

void ListSoldiers(Command const& c)
{
	bool const detail = Integer(c, "detail", 0) != 0;
	Emit(Json{}.str("probe", "soldiers").num("line", c.line).flag("detail", detail).raw("soldiers", SoldierList(detail)));
}

void DumpSoldier(Command const& c)
{
	SOLDIERTYPE const& s = ExistingSoldier(Required(c, "who"));
	Emit(Json{}.str("probe", "soldier").num("line", c.line).raw("soldier", DescribeDetail(s)));
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

struct AttackState
{
	UINT16 usAttackingWeapon;
	UINT8 ubAttackingHand;
	WeaponModes bWeaponMode;
	INT8 bDoBurst;
	INT8 bAimTime;
	UINT8 bAimShotLocation;
	INT8 bTargetLevel;
	INT8 bTargetCubeLevel;
	BOOLEAN fDontChargeReadyAPs;
	SOLDIERTYPE const* CTGTTarget;
	UINT16 usAnimState;
};

AttackState CaptureAttackState(SOLDIERTYPE const& s)
{
	return AttackState{
		s.usAttackingWeapon, s.ubAttackingHand, s.bWeaponMode, s.bDoBurst, s.bAimTime, s.bAimShotLocation,
		s.bTargetLevel, s.bTargetCubeLevel, s.fDontChargeReadyAPs, s.CTGTTarget, s.usAnimState,
	};
}

void RestoreAttackState(SOLDIERTYPE& s, AttackState const& a)
{
	s.usAttackingWeapon   = a.usAttackingWeapon;
	s.ubAttackingHand     = a.ubAttackingHand;
	s.bWeaponMode         = a.bWeaponMode;
	s.bDoBurst            = a.bDoBurst;
	s.bAimTime            = a.bAimTime;
	s.bAimShotLocation    = a.bAimShotLocation;
	s.bTargetLevel        = a.bTargetLevel;
	s.bTargetCubeLevel    = a.bTargetCubeLevel;
	s.fDontChargeReadyAPs = a.fDontChargeReadyAPs;
	s.CTGTTarget          = a.CTGTTarget;
	s.usAnimState         = a.usAnimState;
}

std::vector<std::string> AttackStateChanges(UINT id, AttackState const& was, AttackState const& now)
{
	std::vector<std::string> changes;
	auto const note = [&](char const* field, bool changed) {
		if (changed) changes.push_back(std::to_string(id) + "." + field);
	};
	note("usAttackingWeapon",   was.usAttackingWeapon   != now.usAttackingWeapon);
	note("ubAttackingHand",     was.ubAttackingHand     != now.ubAttackingHand);
	note("bWeaponMode",         was.bWeaponMode         != now.bWeaponMode);
	note("bDoBurst",            was.bDoBurst            != now.bDoBurst);
	note("bAimTime",            was.bAimTime            != now.bAimTime);
	note("bAimShotLocation",    was.bAimShotLocation    != now.bAimShotLocation);
	note("bTargetLevel",        was.bTargetLevel        != now.bTargetLevel);
	note("bTargetCubeLevel",    was.bTargetCubeLevel    != now.bTargetCubeLevel);
	note("fDontChargeReadyAPs", was.fDontChargeReadyAPs != now.fDontChargeReadyAPs);
	note("CTGTTarget",          was.CTGTTarget          != now.CTGTTarget);
	note("usAnimState",         was.usAnimState         != now.usAnimState);
	return changes;
}

class AttackStateGuard
{
public:
	AttackStateGuard()
	{
		for (UINT i = 0; i < MAX_NUM_SOLDIERS; ++i) saved_[i] = CaptureAttackState(GetMan(i));
	}

	AttackStateGuard(AttackStateGuard const&) = delete;
	AttackStateGuard& operator=(AttackStateGuard const&) = delete;

	~AttackStateGuard()
	{
		for (UINT i = 0; i < MAX_NUM_SOLDIERS; ++i) RestoreAttackState(GetMan(i), saved_[i]);
	}

	std::vector<std::string> Changes() const
	{
		std::vector<std::string> all;
		for (UINT i = 0; i < MAX_NUM_SOLDIERS; ++i)
		{
			for (std::string const& change : AttackStateChanges(i, saved_[i], CaptureAttackState(GetMan(i)))) all.push_back(change);
		}
		return all;
	}

private:
	std::array<AttackState, MAX_NUM_SOLDIERS> saved_{};
};

class TemporaryPocketSwap
{
public:
	TemporaryPocketSwap(SOLDIERTYPE& s, INT8 pocket) : soldier_(s), pocket_(pocket) { Swap(); }

	TemporaryPocketSwap(TemporaryPocketSwap const&) = delete;
	TemporaryPocketSwap& operator=(TemporaryPocketSwap const&) = delete;

	~TemporaryPocketSwap() { Swap(); }

private:
	void Swap()
	{
		if (pocket_ != HANDPOS) SwapObjs(&soldier_.inv[HANDPOS], &soldier_.inv[pocket_]);
	}

	SOLDIERTYPE& soldier_;
	INT8 pocket_;
};

std::vector<INT8> AimTimes(Command const& c)
{
	std::string const text = Text(c, "aims", DEFAULT_AIMS);
	std::istringstream list(text);
	std::vector<INT8> aims;
	std::string item;
	while (std::getline(list, item, ','))
	{
		long long const aim = ParseInteger("aims", item);
		if (aim < AP_MIN_AIM_ATTACK || aim > AP_MAX_AIM_ATTACK) throw std::runtime_error("aim time out of range: " + item);
		aims.push_back(static_cast<INT8>(aim));
	}
	if (aims.empty()) throw std::runtime_error("aims is empty");
	return aims;
}

int CursorChance(UINT32 chance, UINT8 chanceToGetThrough)
{
	int shown = static_cast<int>(chance);
	shown *= chanceToGetThrough / static_cast<float>(PERCENT);
	return shown;
}

void ProbeChanceToHit(Command const& c)
{
	if (!gfWorldLoaded) throw std::runtime_error("no world loaded");
	SOLDIERTYPE& s = ExistingSoldier(Required(c, "shooter"));
	UINT16 const weapon = s.inv[HANDPOS].usItem;
	if (!IsGun(weapon)) throw std::runtime_error("shooter has no gun in hand: " + std::to_string(s.ubID));

	SOLDIERTYPE* victim = nullptr;
	GridNo target = NOWHERE;
	INT8 targetLevel = 0;
	if (Has(c, "target"))
	{
		victim = &ExistingSoldier(Required(c, "target"));
		target = victim->sGridNo;
		targetLevel = victim->bLevel;
	}
	else
	{
		target = GridArgument(c, "to");
		targetLevel = static_cast<INT8>(Integer(c, "toLevel", 0));
		victim = WhoIsThere2(target, targetLevel);
	}
	std::string const locationName = Text(c, "location", "torso");
	UINT8 const location = Lookup(AIM_LOCATIONS, c, "location", "torso");
	std::vector<INT8> const aims = AimTimes(c);
	bool const victimStands = victim && gAnimControl[victim->usAnimState].ubEndHeight != ANIM_PRONE;
	UINT8 const aimShotLocation = victimStands ? location : AIM_SHOT_RANDOM;
	GridNo const apTarget = victim ? victim->sGridNo : target;

	AttackStateGuard const guard;
	s.bAimShotLocation  = aimShotLocation;
	s.bWeaponMode       = WM_NORMAL;
	s.bDoBurst          = 0;
	s.ubAttackingHand   = HANDPOS;
	s.usAttackingWeapon = weapon;
	s.bTargetLevel      = targetLevel;
	s.bTargetCubeLevel  = 0;

	UINT8 const chanceToGetThrough = victim ?
		SoldierToSoldierBodyPartChanceToGetThrough(&s, victim, aimShotLocation) :
		SoldierToLocationChanceToGetThrough(&s, target, targetLevel, 0, nullptr);

	std::vector<std::string> results;
	for (INT8 const aim : aims)
	{
		s.bAimTime = aim;
		UINT8 const apCost = CalcTotalAPsToAttack(&s, apTarget, TRUE, aim);
		UINT32 const chance = CalcChanceToHitGun(&s, target, aim, aimShotLocation, FALSE);
		results.push_back(Json{}
			.num("aim", aim)
			.num("chance", chance)
			.num("apCost", apCost)
			.num("cursorChance", CursorChance(chance, chanceToGetThrough))
			.text());
	}

	Emit(Json{}
		.str("probe", "cth")
		.num("line", c.line)
		.num("shooter", s.ubID)
		.raw("target", NullableId(victim))
		.num("targetGridNo", target)
		.num("targetLevel", targetLevel)
		.str("location", locationName)
		.num("aimShotLocation", aimShotLocation)
		.num("weapon", weapon)
		.num("ap", s.bActionPoints)
		.num("chanceToGetThrough", chanceToGetThrough)
		.raw("results", JsonArray(results))
		.strs("restored", guard.Changes()));
}

void ProbeBestShot(Command const& c)
{
	if (!gfWorldLoaded) throw std::runtime_error("no world loaded");
	SOLDIERTYPE& s = ExistingSoldier(Required(c, "who"));
	INT8 const weaponSlot = FindAIUsableObjClass(&s, IC_GUN);
	if (weaponSlot == NO_SLOT) throw std::runtime_error("soldier has no AI-usable gun: " + std::to_string(s.ubID));
	bool const keepAim = Integer(c, "keepAim", 0) != 0;

	AttackStateGuard const guard;
	TemporaryPocketSwap const swap(s, weaponSlot);
	if (!keepAim) s.bAimShotLocation = AIM_SHOT_RANDOM;
	UINT8 const aimShotLocation = s.bAimShotLocation;
	INT8 const soldierTargetLevel = s.bTargetLevel;

	ATTACKTYPE best{};
	CalcBestShot(&s, &best);

	Emit(Json{}
		.str("probe", "bestshot")
		.num("line", c.line)
		.num("who", s.ubID)
		.num("weaponSlot", weaponSlot)
		.num("weapon", s.inv[HANDPOS].usItem)
		.num("ap", s.bActionPoints)
		.num("aimShotLocation", aimShotLocation)
		.num("soldierTargetLevel", soldierTargetLevel)
		.flag("possible", best.ubPossible)
		.raw("opponent", NullableId(best.opponent))
		.num("target", best.sTarget)
		.num("targetLevel", best.bTargetLevel)
		.num("aimTime", best.ubAimTime)
		.num("chanceToReallyHit", best.ubChanceToReallyHit)
		.num("apCost", best.ubAPCost)
		.num("attackValue", best.iAttackValue)
		.strs("restored", guard.Changes()));
}

void ProbeLight(Command const& c)
{
	if (!gfWorldLoaded) throw std::runtime_error("no world loaded");
	GridNo const g = GridArgument(c, "g");
	INT8 const level = static_cast<INT8>(Integer(c, "level", 0));
	Json json;
	json.str("probe", "light").num("line", c.line).num("g", g).num("level", level)
		.num("ambient", LightGetAmbient()).num("trueLevel", LightTrueLevel(g, level));
	if (Has(c, "viewer"))
	{
		SOLDIERTYPE& viewer = ExistingSoldier(Required(c, "viewer"));
		json.num("viewer", viewer.ubID).num("distanceVisible", DistanceVisible(&viewer, DIRECTION_IRRELEVANT, DIRECTION_IRRELEVANT, g, level));
	}
	Emit(json);
}

void Dispatch(Command const& c)
{
	if (c.name == "sector")   return LoadSector(c);
	if (c.name == "save")     return LoadSave(c);
	if (c.name == "soldiers") return ListSoldiers(c);
	if (c.name == "soldier")  return DumpSoldier(c);
	if (c.name == "costs")    return DumpMovementCosts(c);
	if (c.name == "path")     return ProbePath(c);
	if (c.name == "los")      return ProbeLineOfSight(c);
	if (c.name == "cth")      return ProbeChanceToHit(c);
	if (c.name == "bestshot") return ProbeBestShot(c);
	if (c.name == "light")    return ProbeLight(c);
	throw std::runtime_error("unknown command " + c.name);
}

void OpenOutput()
{
	char const* const path = std::getenv(OUTPUT_ENV);
	std::FILE* const file = path && *path ? std::fopen(path, "w") : gStdoutFd >= 0 ? fdopen(gStdoutFd, "w") : stdout;
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

void Oracle_PrepareProcess()
{
	std::fflush(stdout);
	gStdoutFd = dup(STDOUT_FILENO);
	dup2(STDERR_FILENO, STDOUT_FILENO);
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
