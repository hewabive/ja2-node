// Links against Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Written for ja2-node as a native oracle harness, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/PathAI.cc FindBestPath, PlotPath; src/game/Tactical/LOS.cc LineOfSightTest,
// @src SoldierToSoldierLineOfSightTest; src/game/TileEngine/WorldDef.cc LoadWorld, gubWorldMovementCosts
// @src src/game/Tactical/Weapons.cc CalcChanceToHitGun; src/game/Tactical/Points.cc CalcTotalAPsToAttack;
// @src src/game/Tactical/UI_Cursors.cc; src/game/TacticalAI/Attacks.cc CalcBestShot; src/game/TacticalAI/DecideAction.cc;
// @src src/game/TileEngine/Lighting.cc LightTrueLevel, LightSetBaseLevel, LightSprites; src/game/Strategic/Game_Clock.cc
// @src UpdateGameClockGlobals; src/game/Strategic/Strategic_Movement.cc GetSectorMvtTimeForGroup, CalculateTravelTimeOfGroup;
// @src src/game/Strategic/Strategic_Pathing.cc BuildAStrategicPath, RebuildWayPointsForGroupPath
// @src src/game/Strategic/StrategicMap.cc OKForSectorExit, SetupTacticalTraversalInformation; src/game/TileEngine/Map_Edgepoints.cc
// @src GenerateMapEdgepoints, CalcMapEdgepointClassInsertionCode; src/game/Tactical/Soldier_Init_List.cc AddSoldierInitListEnemyDefenceSoldiers
// @src src/game/Tactical/Arms_Dealer_Init.cc, ArmsDealerInvInit.cc, ShopKeeper_Interface.cc (merchants)
#include "Oracle.h"

#include "AI.h"
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
#include "Text.h"
#include "Weapons.h"
#include "WorldDef.h"
#include "WorldMan.h"
#include "Auto_Resolve.h"
#include "JAScreens.h"
#include "Player_Command.h"
#include "PreBattle_Interface.h"
#include "Militia_Control.h"
#include "Queen_Command.h"
#include "Strategic_Status.h"
#include "Strategic_Town_Loyalty.h"
#include "Campaign_Types.h"
#include "Game_Event_Hook.h"
#include "Game_Events.h"
#include "Map_Screen_Helicopter.h"
#include "Map_Screen_Interface_Map.h"
#include "Squads.h"
#include "StrategicMapSecretModel.h"
#include "StrategicMap_Secrets.h"
#include "Strategic_Movement.h"
#include "Strategic_Pathing.h"
#include "Vehicles.h"
#include "Assignments.h"
#include "LaptopSave.h"
#include "SAM_Sites.h"
#include "Strategic_Mines.h"
#include "Town_Militia.h"
#include "Campaign.h"
#include "Campaign_Init.h"
#include "GameSettings.h"
#include "Meanwhile.h"
#include "Strategic_AI.h"
#include "MapScreen.h"
#include "Quests.h"
#include "Map_Edgepoints.h"
#include "Soldier_Init_List.h"
#include "Strategic.h"
#include "Creature_Spreading.h"
#include "Morale.h"
#include "Strategic_Merc_Handler.h"
#include "Arms_Dealer_Init.h"
#include "DealerModel.h"
#include "Facts.h"
#include "ShopKeeper_Interface.h"
#include "Merc_Contract.h"
#include "Finances.h"
#include "Dialogue_Control.h"
#include "Map_Screen_Interface.h"
#include "History.h"
#include "Mercs.h"
#include "Smell.h"
#include "Soldier_Macros.h"

#include <string_theory/string>

#include <algorithm>
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
INT16 OraclePickGridNoNearestEdge(SOLDIERTYPE* s, UINT8 direction);
extern INT32 giHabitatedDistance;
extern INT32 giPopulationModifier;
extern INT32 giLairID;
extern INT32 giDestroyedLairID;
extern BOOLEAN gfCreatureMeanwhileScenePlayed;
extern bool gOracleSkipCreatureBattle;
extern INT8 gOracleStrategicMoraleUpdateCounter;
UINT16 OracleFindRefusalReason(SOLDIERTYPE const* s);
BOOLEAN OracleContractIsExpiring(SOLDIERTYPE* s);
BOOLEAN OracleContractIsGoingToExpireSoon(SOLDIERTYPE* s);
UINT8 OracleContractRenewalCount();
UINT8 OracleContractRenewalProfile(UINT8 i);
UINT8 OracleCurrentContractRenewal();
UINT8 OracleContractRenewalInProgress();
void OracleSetContractRenewals(std::vector<UINT8> const& profiles);
void OracleResetContractRenewalSequence();
void OracleBeginRemoveMercFromContract(SOLDIERTYPE* s);
INT32 OracleLeaveListItems(UINT32 slot, std::vector<OBJECTTYPE>* items);
UINT32 OracleLeaveListOwner(UINT32 slot);
UINT32 OracleCalcNewSalary(UINT32 old, UINT32 max);
void HandleEquipmentLeftInOmerta(UINT32 uiSlotIndex);
void HandleEquipmentLeftInDrassen(UINT32 uiSlotIndex);
void DailyUpdateOfMercSite();
extern BOOLEAN gfContractRenewalSquenceOn;
extern BOOLEAN gfInContractMenuFromRenewSequence;
INT16 OraclePickGridNoToWalkIn(SOLDIERTYPE* s, UINT8 insertionCode, UINT32* attempts);
BOOLEAN OracleSoldierOKForSectorExit(SOLDIERTYPE* s, INT8 exitDirection, UINT16 additional);
void OracleSortSoldierInitList();
void OracleDeterminePersistentEncounterCode(GROUP* battle_group, SGPSector const& sector);
extern UINT8 gubTacticalDirection;
extern INT16 gsEnemyGainedControlOfSectorID;
extern INT16 gsCiviliansEatenByMonsters;
extern INT8 SquadMovementGroups[];
extern INT16 sDeadMercs[NUMBER_OF_SQUADS][NUMBER_OF_DEAD_SOLDIERS_ON_SQUAD];
extern UINT8 gubVehicleMovementGroups[];
extern BOOLEAN gfExtraElites;
extern INT32 giForcePercentage;
extern INT32 giArmyAlertness;
extern INT32 giArmyAlertnessDecay;
extern UINT8 gubNumAwareBattles;
extern BOOLEAN gfQueenAIAwake;
extern INT32 giReinforcementPool;
extern INT32 giReinforcementPoints;
extern INT32 giRequestPoints;
extern UINT8 gubQueenPriorityPhase;
extern BOOLEAN gfMassFortificationOrdered;
extern UINT8 gubMinEnemyGroupSize;
extern UINT8 gubHoursGracePeriod;
extern UINT16 gusPlayerBattleVictories;
extern std::vector<PATROL_GROUP> gPatrolGroup;
extern std::vector<ARMY_COMPOSITION> gArmyComp;
extern std::vector<GARRISON_GROUP> gGarrisonGroup;
extern std::unique_ptr<UINT8 []> gubGarrisonReinforcementsDenied;
extern bool gOracleShopHoursActive;
extern UINT32 gOracleShopOpeningTime;
extern UINT32 gOracleShopClosingTime;

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

std::string CachedStructureHeights()
{
	std::vector<std::string> cached;
	for (GridNo g = 0; g < WORLD_MAX; ++g)
	{
		int index = 0;
		for (STRUCTURE const* s = gpWorldLevelData[g].pStructureHead; s; s = s->pNext, ++index)
		{
			if (s->ubStructureHeight != 0) cached.push_back("[" + std::to_string(g) + "," + std::to_string(index) + "]");
		}
	}
	return JsonArray(cached);
}

void LoadSector(Command const& c)
{
	std::string const name = Text(c, "_0", Text(c, "sector", ""));
	if (name.empty()) throw std::runtime_error("sector needs a name such as A9");
	SGPSector const sector = SGPSector::FromShortString(ST::string(name), static_cast<INT8>(Integer(c, "z", 0)));
	if (!sector.IsValid()) throw std::runtime_error("invalid sector " + name);
	gWorldSector = sector;
	if (Has(c, "hour"))
	{
		guiGameClock = NUM_SEC_IN_DAY + static_cast<UINT32>(Integer(c, "hour", 0)) * NUM_SEC_IN_HOUR;
		UpdateGameClockGlobals(gpGameClockString);
	}
	ST::string const map = Has(c, "map") ? ST::string(Text(c, "map", "")) : GetMapFileName(sector, FALSE);
	LoadWorld(map);
	Emit(Json{}
		.str("probe", "sector")
		.str("sector", sector.AsShortString().to_std_string())
		.num("z", sector.z)
		.str("map", map.to_std_string())
		.num("hour", GetWorldHour())
		.num("ambient", LightGetAmbient())
		.raw("structureHeights", CachedStructureHeights())
		.raw("soldiers", SoldierList()));
}

void LoadSave(Command const& c)
{
	std::string const name = Text(c, "_0", Text(c, "name", ""));
	if (name.empty()) throw std::runtime_error("save needs a name such as SaveGame01");
	LoadSavedGame(ST::string(name));
	OracleResetContractRenewalSequence();
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

void SetAmbientLight(Command const& c)
{
	if (!gfWorldLoaded) throw std::runtime_error("no world loaded");
	UINT8 const level = static_cast<UINT8>(Required(c, "level"));
	LightSetBaseLevel(level);
	Emit(Json{}.str("probe", "ambient").num("line", c.line).num("level", level));
}

void DumpLights(Command const& c)
{
	if (!gfWorldLoaded) throw std::runtime_error("no world loaded");
	INT8 const level = static_cast<INT8>(Integer(c, "level", 0));
	std::vector<std::uint8_t> levels(WORLD_MAX);
	for (GridNo g = 0; g < WORLD_MAX; ++g) levels[g] = LightTrueLevel(g, level);
	std::map<int, long long> histogram;
	for (std::uint8_t const value : levels) ++histogram[value];
	Json counts;
	for (auto const& [value, count] : histogram) counts.num(std::to_string(value).c_str(), count);
	std::vector<std::string> sprites;
	CFOR_EACH_LIGHT_SPRITE(l)
	{
		sprites.push_back(Json{}.num("x", l->iX).num("y", l->iY).num("flags", l->uiFlags)
			.str("template", LightSpriteGetTypeName(l)).text());
	}
	char hash[16];
	std::snprintf(hash, sizeof(hash), "%08x", Fnv1a(levels.data(), levels.size()));
	Json json;
	json.str("probe", "lights").num("line", c.line)
		.str("sector", gWorldSector.AsShortString().to_std_string())
		.num("level", level).num("ambient", LightGetAmbient())
		.str("layout", "u8[gridNo]").nums("shape", {WORLD_MAX})
		.str("fnv1a32", hash)
		.raw("histogram", counts.text())
		.raw("sprites", JsonArray(sprites));
	if (Text(c, "format", "base64") == "base64") json.str("base64", Base64(levels.data(), levels.size()));
	Emit(json);
}

std::map<std::string, UINT8> const TRANSPORT_MASKS{
	{"FOOT", FOOT}, {"CAR", CAR}, {"TRUCK", TRUCK}, {"TRACKED", TRACKED}, {"AIR", AIR},
};

constexpr int STRATEGIC_SECTORS = 256;
constexpr int STRATEGIC_DIRECTIONS = 4;
constexpr int TRAVERSABILITY_ENTRIES = 5;

std::string Numbers(std::vector<long long> const& values)
{
	std::vector<std::string> items;
	for (long long const v : values) items.push_back(std::to_string(v));
	return JsonArray(items);
}

std::string StrategicSector(SGPSector const& s)
{
	return Numbers({s.x, s.y, s.z});
}

SGPSector StrategicSectorArgument(Command const& c, std::string const& key)
{
	std::string const name = Text(c, key, "");
	if (name.empty()) throw std::runtime_error("missing argument " + key);
	SGPSector const s = SGPSector::FromShortString(ST::string(name));
	if (!s.IsValid()) throw std::runtime_error("invalid sector " + name);
	return s;
}

void ProbeStrategicCosts(Command const& c)
{
	std::string const maskName = Text(c, "mask", "FOOT");
	GROUP g{};
	g.fPlayer = FALSE;
	g.ubTransportationMask = Lookup(TRANSPORT_MASKS, c, "mask", "FOOT");
	std::vector<std::string> traversability;
	std::vector<std::string> minutes;
	for (int id = 0; id < STRATEGIC_SECTORS; ++id)
	{
		SECTORINFO const& s = SectorInfo[id];
		std::vector<long long> t;
		for (int k = 0; k < TRAVERSABILITY_ENTRIES; ++k) t.push_back(s.ubTraversability[k]);
		traversability.push_back(Numbers(t));
		std::vector<long long> m;
		for (int dir = 0; dir < STRATEGIC_DIRECTIONS; ++dir) m.push_back(GetSectorMvtTimeForGroup(static_cast<UINT8>(id), static_cast<UINT8>(dir), &g));
		minutes.push_back(Numbers(m));
	}
	Emit(Json{}
		.str("probe", "stratcosts")
		.num("line", c.line)
		.str("mask", maskName)
		.num("maskValue", g.ubTransportationMask)
		.raw("traversability", JsonArray(traversability))
		.raw("minutes", JsonArray(minutes)));
}

UINT8 StrategicMoveBetween(INT32 from, INT32 to)
{
	INT32 const delta = to - from;
	if (delta == NORTH_MOVE) return NORTH_STRATEGIC_MOVE;
	if (delta == EAST_MOVE) return EAST_STRATEGIC_MOVE;
	if (delta == SOUTH_MOVE) return SOUTH_STRATEGIC_MOVE;
	return WEST_STRATEGIC_MOVE;
}

void DeleteScratchAboutToArriveEvents(UINT8 id)
{
	int count = 0;
	for (STRATEGICEVENT const* e = gpEventList; e; e = e->next)
	{
		if (e->ubCallbackID == EVENT_GROUP_ABOUT_TO_ARRIVE && e->uiParam == id) ++count;
	}
	while (count-- > 0) DeleteStrategicEvent(EVENT_GROUP_ABOUT_TO_ARRIVE, id);
}

void ProbeStrategicPath(Command const& c)
{
	SGPSector const from = StrategicSectorArgument(c, "from");
	SGPSector const to = StrategicSectorArgument(c, "to");
	std::string const maskName = Text(c, "mask", "FOOT");
	bool const tactical = Integer(c, "tactical", 0) != 0;
	GROUP* const saved = gpGroupList;
	gpGroupList = NULL;
	GROUP* const g = CreateNewPlayerGroupDepartingFromSector(from);
	g->ubTransportationMask = Lookup(TRANSPORT_MASKS, c, "mask", "FOOT");
	PathSt* const path = BuildAStrategicPath(from.AsStrategicIndex(), to.AsStrategicIndex(), *g, tactical);
	std::vector<long long> nodes;
	std::vector<long long> minutes;
	for (PathSt const* n = path; n; n = n->pNext)
	{
		nodes.push_back(n->uiSectorId);
		if (!n->pNext) continue;
		UINT8 const sector = SGPSector::FromStrategicIndex(static_cast<UINT16>(n->uiSectorId)).AsByte();
		minutes.push_back(GetSectorMvtTimeForGroup(sector, StrategicMoveBetween(n->uiSectorId, n->pNext->uiSectorId), g));
	}
	UINT32 const now = GetWorldTotalMin();
	RebuildWayPointsForGroupPath(path, *g);
	std::vector<std::string> waypoints;
	for (WAYPOINT const* w = g->pWaypoints; w; w = w->next) waypoints.push_back(StrategicSector(w->sSector));
	Json json;
	json.str("probe", "stratpath")
		.num("line", c.line)
		.str("from", from.AsShortString().to_std_string())
		.str("to", to.AsShortString().to_std_string())
		.str("mask", maskName)
		.flag("tactical", tactical)
		.raw("path", Numbers(nodes))
		.raw("minutes", Numbers(minutes))
		.raw("waypoints", JsonArray(waypoints))
		.raw("next", StrategicSector(g->ubNext))
		.flag("betweenSectors", g->fBetweenSectors)
		.num("arrivalInMinutes", static_cast<long long>(g->uiArrivalTime) - now)
		.num("traverseTime", g->uiTraverseTime)
		.num("eta", CalculateTravelTimeOfGroup(g));
	UINT8 const id = g->ubGroupID;
	ClearStrategicPathList(path, 0);
	RemoveGroup(*g);
	DeleteScratchAboutToArriveEvents(id);
	gpGroupList = saved;
	Emit(json);
}

std::string DescribeGroup(GROUP const& g)
{
	std::vector<std::string> waypoints;
	for (WAYPOINT const* w = g.pWaypoints; w; w = w->next) waypoints.push_back(StrategicSector(w->sSector));
	Json json;
	json.num("id", g.ubGroupID)
		.flag("player", g.fPlayer)
		.flag("vehicle", g.fVehicle)
		.flag("persistent", g.fPersistant)
		.flag("debug", g.fDebugGroup)
		.num("size", g.ubGroupSize)
		.raw("sector", StrategicSector(g.ubSector))
		.raw("next", StrategicSector(g.ubNext))
		.raw("prev", StrategicSector(g.ubPrev))
		.num("originalSector", g.ubOriginalSector)
		.flag("betweenSectors", g.fBetweenSectors)
		.num("moveType", g.ubMoveType)
		.num("nextWaypointId", g.ubNextWaypointID)
		.num("arrivalTime", g.uiArrivalTime)
		.num("traverseTime", g.uiTraverseTime)
		.num("transportMask", g.ubTransportationMask)
		.num("flags", g.uiFlags)
		.num("createdSectorId", g.ubCreatedSectorID)
		.num("sectorIdOfLastReassignment", g.ubSectorIDOfLastReassignment)
		.flag("atFinalDestination", GroupAtFinalDestination(&g))
		.num("eta", CalculateTravelTimeOfGroup(&g))
		.raw("waypoints", JsonArray(waypoints));
	if (g.fPlayer)
	{
		std::vector<long long> members;
		CFOR_EACH_PLAYER_IN_GROUP(p, &g) members.push_back(p->pSoldier->ubID);
		json.raw("members", Numbers(members));
	}
	else
	{
		ENEMYGROUP const& e = *g.pEnemyGroup;
		json.raw("enemy", Numbers({e.ubNumTroops, e.ubNumElites, e.ubNumAdmins, e.ubPendingReinforcements, e.ubAdminsInBattle,
			e.ubIntention, e.ubTroopsInBattle, e.ubElitesInBattle}));
	}
	return json.text();
}

std::string DescribeSectorInfo(SECTORINFO const& s)
{
	return Numbers({s.uiFlags, s.ubGarrisonID, s.ubPendingReinforcements, s.ubNumTroops, s.ubNumElites, s.ubNumAdmins, s.ubNumCreatures,
		s.ubTroopsInBattle, s.ubElitesInBattle, s.ubAdminsInBattle, s.ubCreaturesInBattle, s.uiFacilitiesFlags, s.bBloodCats,
		s.bBloodCatPlacements, s.ubTravelRating, s.ubNumberOfCivsAtLevel[0], s.ubNumberOfCivsAtLevel[1], s.ubNumberOfCivsAtLevel[2],
		s.uiTimeCurrentSectorWasLastLoaded, s.uiTimeLastPlayerLiberated, s.fSurfaceWasEverPlayerControlled,
		s.uiNumberOfWorldItemsInTempFileThatCanBeSeenByPlayer});
}

void DumpStrategicGroups(Command const& c)
{
	std::vector<std::string> groups;
	CFOR_EACH_GROUP(g) groups.push_back(DescribeGroup(*g));
	std::vector<std::string> squads;
	for (int q = 0; q < NUMBER_OF_SQUADS; ++q)
	{
		std::vector<long long> members;
		for (SOLDIERTYPE const* s : Squad[q]) members.push_back(s ? s->ubID : -1);
		squads.push_back(Numbers(members));
	}
	std::vector<long long> squadGroups;
	for (int q = 0; q < NUMBER_OF_SQUADS; ++q) squadGroups.push_back(SquadMovementGroups[q]);
	std::vector<std::string> dead;
	for (int q = 0; q < NUMBER_OF_SQUADS; ++q)
	{
		std::vector<long long> row;
		for (int k = 0; k < NUMBER_OF_DEAD_SOLDIERS_ON_SQUAD; ++k) row.push_back(sDeadMercs[q][k]);
		dead.push_back(Numbers(row));
	}
	std::vector<long long> vehicleGroups;
	for (int k = 0; k < MAX_VEHICLES; ++k) vehicleGroups.push_back(gubVehicleMovementGroups[k]);
	std::vector<std::string> vehicles;
	for (VEHICLETYPE const& v : pVehicleList)
	{
		std::vector<long long> passengers;
		for (SOLDIERTYPE const* p : v.pPassengers) if (p) passengers.push_back(p->ubID);
		vehicles.push_back(Json{}
			.flag("valid", v.fValid)
			.num("movementGroup", v.ubMovementGroup)
			.num("type", v.ubVehicleType)
			.raw("sector", StrategicSector(v.sSector))
			.flag("betweenSectors", v.fBetweenSectors)
			.flag("destroyed", v.fDestroyed)
			.raw("passengers", Numbers(passengers))
			.text());
	}
	std::vector<std::string> sectors;
	for (SECTORINFO const& s : SectorInfo) sectors.push_back(DescribeSectorInfo(s));
	std::vector<std::string> elements;
	for (StrategicMapElement const& e : StrategicMap) elements.push_back(Numbers({e.bNameId, e.fEnemyControlled, e.fEnemyAirControlled, e.bSAMCondition}));
	std::vector<std::string> underground;
	for (UNDERGROUND_SECTORINFO const* u = gpUndergroundSectorInfoHead; u; u = u->next)
	{
		underground.push_back(Numbers({u->ubSector.x, u->ubSector.y, u->ubSector.z, u->uiFlags, u->ubNumElites, u->ubNumTroops, u->ubNumAdmins,
			u->ubNumCreatures, u->uiTimeCurrentSectorWasLastLoaded, u->ubAdjacentSectors, u->ubCreatureHabitat}));
	}
	std::vector<std::string> events;
	for (STRATEGICEVENT const* e = gpEventList; e; e = e->next)
	{
		if (e->ubCallbackID != EVENT_GROUP_ARRIVAL && e->ubCallbackID != EVENT_GROUP_ABOUT_TO_ARRIVE) continue;
		events.push_back(Numbers({e->uiTimeStamp, e->ubCallbackID, e->uiParam}));
	}
	std::vector<std::string> mercs;
	CFOR_EACH_IN_TEAM(s, OUR_TEAM)
	{
		std::vector<long long> path;
		for (PathSt const* n = s->pMercPath; n; n = n->pNext) path.push_back(n->uiSectorId);
		mercs.push_back(Json{}
			.num("id", s->ubID)
			.num("profile", s->ubProfile)
			.num("groupId", s->ubGroupID)
			.raw("sector", StrategicSector(s->sSector))
			.flag("betweenSectors", s->fBetweenSectors)
			.num("assignment", s->bAssignment)
			.num("prevSectorId", s->ubPrevSectorID)
			.num("insertionCode", s->ubStrategicInsertionCode)
			.raw("path", Numbers(path))
			.text());
	}
	std::vector<std::string> secrets;
	for (auto const* secret : GCM->getMapSecrets()) secrets.push_back(Numbers({secret->sectorID, IsSecretFoundAt(secret->sectorID)}));
	Emit(Json{}
		.str("probe", "groups")
		.num("line", c.line)
		.num("worldMinutes", GetWorldTotalMin())
		.raw("groups", JsonArray(groups))
		.raw("squads", JsonArray(squads))
		.raw("squadGroups", Numbers(squadGroups))
		.raw("deadSquadMembers", JsonArray(dead))
		.raw("vehicleGroups", Numbers(vehicleGroups))
		.raw("vehicles", JsonArray(vehicles))
		.num("helicopterVehicleId", iHelicopterVehicleId)
		.flag("helicopterAirborne", fHelicopterIsAirBorne)
		.raw("selectedSector", StrategicSector(sSelMap))
		.raw("sectors", JsonArray(sectors))
		.raw("elements", JsonArray(elements))
		.raw("underground", JsonArray(underground))
		.raw("events", JsonArray(events))
		.raw("mercs", JsonArray(mercs))
		.raw("secrets", JsonArray(secrets)));
}

std::vector<OracleDraw> gAutoResolveDraws;

struct AutoResolveSetup
{
	bool      ready{false};
	SGPSector sector;
};

AutoResolveSetup gAutoResolveSetup;

enum AutoResolveMark : UINT32
{
	AR_MARK_SETUP = 1,
	AR_MARK_RATINGS,
	AR_MARK_BATTLE,
	AR_MARK_RETREAT,
	AR_MARK_SURRENDER,
	AR_MARK_END,
	AR_MARK_BANDAGE,
	AR_MARK_CLOSE,
	AR_MARK_POST,
	AR_MARK_DONE,
};

constexpr int AR_SIDES = 3;
constexpr long long DEFAULT_AR_MAX_SLICES = 100000;
constexpr int AR_MAX_LOOP = 1000000;
constexpr UINT8 AR_NO_TOWN = 0;

std::map<std::string, UINT8> const ENCOUNTER_CODES{
	{"encounter", ENEMY_ENCOUNTER_CODE}, {"invasion", ENEMY_INVASION_CODE}, {"creature", CREATURE_ATTACK_CODE},
};

std::vector<std::string> SplitList(std::string const& text, char separator)
{
	std::vector<std::string> parts;
	std::string part;
	std::istringstream in(text);
	while (std::getline(in, part, separator))
	{
		if (!part.empty()) parts.push_back(part);
	}
	return parts;
}

std::vector<long long> IntegerList(Command const& c, std::string const& key, size_t count)
{
	std::vector<long long> values;
	for (std::string const& part : SplitList(Text(c, key, ""), ',')) values.push_back(ParseInteger(key, part));
	if (values.size() != count) throw std::runtime_error(key + " needs " + std::to_string(count) + " comma-separated values");
	return values;
}

void SeedRandomEngine(Command const& c)
{
	UINT32 const seed = static_cast<UINT32>(Required(c, "value"));
	bool const reseedPre = Text(c, "pre", "keep") == "reseed";
	OracleSeedRandom(seed, reseedPre);
	Emit(Json{}.str("probe", "seed").num("line", c.line).num("value", seed).flag("reseedPre", reseedPre).num("preRandomIndex", guiPreRandomIndex));
}

std::string DescribeEnemyCounts(SGPSector const& sector)
{
	SECTORINFO const& si = SectorInfo[sector.AsByte()];
	UINT8 admins = 0, troops = 0, elites = 0;
	GetNumberOfEnemiesInSector(sector, &admins, &troops, &elites);
	return Json{}
		.nums("stationary", {si.ubNumAdmins, si.ubNumTroops, si.ubNumElites})
		.nums("total", {admins, troops, elites})
		.num("inSector", NumEnemiesInSector(sector))
		.nums("militia", {si.ubNumberOfCivsAtLevel[GREEN_MILITIA], si.ubNumberOfCivsAtLevel[REGULAR_MILITIA], si.ubNumberOfCivsAtLevel[ELITE_MILITIA]})
		.flag("enemyControlled", StrategicMap[sector.AsStrategicIndex()].fEnemyControlled)
		.text();
}

void SetupAutoResolve(Command const& c)
{
	std::string const name = Text(c, "sector", Text(c, "_0", ""));
	SGPSector const sector = SGPSector::FromShortString(ST::string(name), 0);
	if (!sector.IsValid()) throw std::runtime_error("arsetup needs sector=<A1..P16>");
	SECTORINFO& si = SectorInfo[sector.AsByte()];
	if (Has(c, "militia"))
	{
		std::vector<long long> const m = IntegerList(c, "militia", 3);
		si.ubNumberOfCivsAtLevel[GREEN_MILITIA] = static_cast<UINT8>(m[0]);
		si.ubNumberOfCivsAtLevel[REGULAR_MILITIA] = static_cast<UINT8>(m[1]);
		si.ubNumberOfCivsAtLevel[ELITE_MILITIA] = static_cast<UINT8>(m[2]);
	}
	if (Has(c, "enemies"))
	{
		std::vector<long long> const e = IntegerList(c, "enemies", 3);
		si.ubNumAdmins = static_cast<UINT8>(e[0]);
		si.ubNumTroops = static_cast<UINT8>(e[1]);
		si.ubNumElites = static_cast<UINT8>(e[2]);
	}
	if (Has(c, "day"))
	{
		guiGameClock = static_cast<UINT32>(Required(c, "day")) * NUM_SEC_IN_DAY + guiGameClock % NUM_SEC_IN_DAY;
		UpdateGameClockGlobals(gpGameClockString);
	}
	std::vector<std::string> groups;
	for (std::string const& spec : SplitList(Text(c, "groups", ""), '/'))
	{
		std::vector<std::string> const parts = SplitList(spec, ':');
		if (parts.size() != 3) throw std::runtime_error("groups needs admins:troops:elites per group, separated by /");
		UINT8 const admins = static_cast<UINT8>(ParseInteger("groups", parts[0]));
		UINT8 const troops = static_cast<UINT8>(ParseInteger("groups", parts[1]));
		UINT8 const elites = static_cast<UINT8>(ParseInteger("groups", parts[2]));
		GROUP const* const g = CreateNewEnemyGroupDepartingFromSector(sector.AsByte(), admins, troops, elites);
		groups.push_back(Json{}.num("id", g->ubGroupID).num("admins", admins).num("troops", troops).num("elites", elites).text());
	}
	bool const tacticalMilitia = Integer(c, "tacticalmilitia", 0) != 0;
	if (tacticalMilitia)
	{
		if (!gfWorldLoaded || gWorldSector != sector) throw std::runtime_error("tacticalmilitia needs the sector loaded");
		gfStrategicMilitiaChangesMade = TRUE;
		ResetMilitia();
	}
	gubEnemyEncounterCode = Lookup(ENCOUNTER_CODES, c, "code", "invasion");
	if (gubEnemyEncounterCode == CREATURE_ATTACK_CODE)
	{
		gubNumCreaturesAttackingTown = static_cast<UINT8>(Integer(c, "creatures", 0));
		gubSectorIDOfCreatureAttack = sector.AsByte();
	}
	gubPBSector = sector;
	gfPersistantPBI = Integer(c, "persistent", 1) != 0;
	gAutoResolveSetup = {true, sector};
	Emit(Json{}
		.str("probe", "arsetup")
		.num("line", c.line)
		.str("sector", sector.AsShortString().to_std_string())
		.num("code", gubEnemyEncounterCode)
		.flag("persistent", gfPersistantPBI)
		.num("day", GetWorldDay())
		.flag("tacticalMilitia", tacticalMilitia)
		.num("creatures", gubEnemyEncounterCode == CREATURE_ATTACK_CODE ? gubNumCreaturesAttackingTown : 0)
		.raw("groups", JsonArray(groups))
		.raw("counts", DescribeEnemyCounts(sector)));
}

std::string DescribeDraws(std::vector<OracleDraw> const& draws);

GROUP* PlayerGroupIn(SGPSector const& sector)
{
	FOR_EACH_GROUP(g)
	{
		if (g->fPlayer && g->ubGroupSize != 0 && !g->fBetweenSectors && g->ubSector == sector) return g;
	}
	return nullptr;
}

void ProbePreBattle(Command const& c)
{
	std::string const name = Text(c, "sector", Text(c, "_0", ""));
	SGPSector const sector = SGPSector::FromShortString(ST::string(name), 0);
	if (!sector.IsValid()) throw std::runtime_error("pbi needs sector=<A1..P16>");
	std::string const who = Text(c, "group", "player");
	GROUP* group = nullptr;
	if (who == "player")
	{
		group = PlayerGroupIn(sector);
		if (!group) throw std::runtime_error("no player group in that sector");
	}
	else if (who == "enemy")
	{
		std::vector<long long> const e = Has(c, "enemies") ? IntegerList(c, "enemies", 3) : std::vector<long long>{0, 4, 0};
		group = CreateNewEnemyGroupDepartingFromSector(sector.AsByte(), static_cast<UINT8>(e[0]), static_cast<UINT8>(e[1]), static_cast<UINT8>(e[2]));
	}
	else if (who != "creature") throw std::runtime_error("group must be player, enemy or creature");
	long long const life = Integer(c, "mercslife", 0);
	if (life > 0)
	{
		FOR_EACH_IN_TEAM(s, OUR_TEAM)
		{
			if (!s->fBetweenSectors && s->sSector == sector) s->bLife = static_cast<INT8>(life);
		}
	}
	bool const highPotential = Integer(c, "highpotential", 0) != 0;
	bool const cantRetreat = Integer(c, "cantretreat", 0) != 0;
	gfHighPotentialForAmbush = highPotential;
	gfCantRetreatInPBI = cantRetreat;
	gubEnemyEncounterCode = NO_ENCOUNTER_CODE;
	std::vector<OracleDraw> draws;
	OracleTraceRandom(&draws);
	OracleDeterminePersistentEncounterCode(group, sector);
	OracleTraceRandom(nullptr);
	Emit(Json{}
		.str("probe", "pbi")
		.num("line", c.line)
		.str("sector", sector.AsShortString().to_std_string())
		.str("group", who)
		.num("groupId", group ? group->ubGroupID : -1)
		.raw("enemies", group && !group->fPlayer ? Json{}.nums("counts", {group->pEnemyGroup->ubNumAdmins, group->pEnemyGroup->ubNumTroops, group->pEnemyGroup->ubNumElites}).text() : "null")
		.flag("highPotentialIn", highPotential)
		.flag("cantRetreatIn", cantRetreat)
		.num("mercsLife", life)
		.num("code", gubEnemyEncounterCode)
		.flag("cantRetreat", gfCantRetreatInPBI)
		.flag("highPotential", gfHighPotentialForAmbush)
		.num("progress", CurrentPlayerProgressPercentage())
		.num("difficulty", gGameOptions.ubDifficultyLevel)
		.raw("draws", DescribeDraws(draws)));
}

void ProbeEnemyCounts(Command const& c)
{
	std::string const name = Text(c, "sector", Text(c, "_0", ""));
	SGPSector const sector = SGPSector::FromShortString(ST::string(name), 0);
	if (!sector.IsValid()) throw std::runtime_error("enemycounts needs sector=<A1..P16>");
	SECTORINFO const& si = SectorInfo[sector.AsByte()];
	UINT8 admins = 0, troops = 0, elites = 0;
	GetNumberOfEnemiesInSector(sector, &admins, &troops, &elites);
	Emit(Json{}
		.str("probe", "enemycounts")
		.num("line", c.line)
		.str("sector", sector.AsShortString().to_std_string())
		.num("garrisonId", si.ubGarrisonID)
		.nums("garrison", {si.ubNumAdmins, si.ubNumTroops, si.ubNumElites})
		.num("stationary", NumStationaryEnemiesInSector(sector))
		.num("mobile", NumMobileEnemiesInSector(sector))
		.nums("total", {admins, troops, elites})
		.num("inSector", NumEnemiesInSector(sector)));
}

std::string DescribeArObject(int slot, OBJECTTYPE const& o)
{
	Json json;
	json.num("slot", slot).num("item", o.usItem).num("count", o.ubNumberOfObjects).num("flags", o.fFlags);
	std::vector<long long> status;
	if (IsGun(o.usItem))
	{
		status.push_back(o.bGunStatus);
		json.num("gunShotsLeft", o.ubGunShotsLeft).num("gunAmmoType", o.ubGunAmmoType).num("gunAmmoItem", o.usGunAmmoItem).num("gunAmmoStatus", o.bGunAmmoStatus);
	}
	else
	{
		for (int i = 0; i < o.ubNumberOfObjects && i < MAX_OBJECTS_PER_SLOT; ++i) status.push_back(o.bStatus[i]);
	}
	json.nums("status", status);
	std::vector<std::string> attachments;
	for (int i = 0; i < MAX_ATTACHMENTS; ++i)
	{
		if (o.usAttachItem[i] == NOTHING) continue;
		attachments.push_back(Json{}.num("index", i).num("item", o.usAttachItem[i]).num("status", o.bAttachStatus[i]).text());
	}
	json.raw("attachments", JsonArray(attachments));
	return json.text();
}

std::string DescribeArInventory(SOLDIERTYPE const& s)
{
	std::vector<std::string> objects;
	for (int slot = 0; slot < NUM_INV_SLOTS; ++slot)
	{
		if (s.inv[slot].usItem != NOTHING) objects.push_back(DescribeArObject(slot, s.inv[slot]));
	}
	return JsonArray(objects);
}

std::string DescribeArProfile(UINT8 profile)
{
	if (profile == NO_PROFILE) return "null";
	MERCPROFILESTRUCT const& p = GetProfile(profile);
	return Json{}
		.num("id", profile)
		.num("evolution", static_cast<long long>(p.bEvolution))
		.num("attitude", p.bAttitude)
		.num("life", p.bLife)
		.raw("stats", Json{}
			.num("lifeMax", p.bLifeMax).num("agility", p.bAgility).num("dexterity", p.bDexterity).num("wisdom", p.bWisdom)
			.num("medical", p.bMedical).num("explosives", p.bExplosive).num("mechanical", p.bMechanical)
			.num("marksmanship", p.bMarksmanship).num("experience", p.bExpLevel).num("strength", p.bStrength)
			.num("leadership", p.bLeadership).text())
		.raw("gains", Json{}
			.num("lifeMax", p.sLifeGain).num("agility", p.sAgilityGain).num("dexterity", p.sDexterityGain).num("wisdom", p.sWisdomGain)
			.num("medical", p.sMedicalGain).num("explosives", p.sExplosivesGain).num("mechanical", p.sMechanicGain)
			.num("marksmanship", p.sMarksmanshipGain).num("experience", p.sExpLevelGain).num("strength", p.sStrengthGain)
			.num("leadership", p.sLeadershipGain).text())
		.nums("statChangeChances", std::vector<long long>(std::begin(p.usStatChangeChances), std::end(p.usStatChangeChances)))
		.nums("statChangeSuccesses", std::vector<long long>(std::begin(p.usStatChangeSuccesses), std::end(p.usStatChangeSuccesses)))
		.num("kills", p.usKills).num("assists", p.usAssists).num("shotsFired", p.usShotsFired).num("shotsHit", p.usShotsHit)
		.num("battlesFought", p.usBattlesFought).num("timesWounded", p.usTimesWounded)
		.text();
}

std::string DescribeArSoldier(SOLDIERTYPE const& s)
{
	return Json{}
		.num("id", s.ubID)
		.num("team", s.bTeam)
		.num("profile", s.ubProfile)
		.num("soldierClass", s.ubSoldierClass)
		.num("body", s.ubBodyType)
		.num("groupId", s.ubGroupID)
		.num("militiaKills", s.ubMilitiaKills)
		.num("gridNo", s.sGridNo)
		.num("level", s.bLevel)
		.num("damage", s.sDamage)
		.num("attackingHand", s.ubAttackingHand)
		.num("attackingWeapon", s.usAttackingWeapon)
		.str("anim", gAnimControl[s.usAnimState].zAnimStr)
		.num("animState", s.usAnimState)
		.num("actionPoints", s.bActionPoints)
		.flag("collapsed", s.bCollapsed)
		.num("doBurst", s.bDoBurst)
		.raw("stats", DescribeStats(s))
		.num("morale", s.bMorale)
		.num("life", s.bLife)
		.num("lifeMax", s.bLifeMax)
		.num("breath", s.bBreath)
		.num("breathMax", s.bBreathMax)
		.num("bleeding", s.bBleeding)
		.nums("skillTraits", {s.ubSkillTrait1, s.ubSkillTrait2})
		.raw("inventory", DescribeArInventory(s))
		.raw("progress", DescribeArProfile(s.ubProfile))
		.text();
}

std::string DescribeArInfo()
{
	OracleARInfo info{};
	if (!OracleAutoResolveInfo(info)) return "null";
	return Json{}
		.num("status", info.status)
		.num("elapsedMs", info.elapsedMs)
		.num("slices", info.slices)
		.nums("sums", {info.playerAttack, info.playerDefence, info.enemyAttack, info.enemyDefence})
		.nums("leadership", {info.playerLeadership, info.enemyLeadership})
		.nums("counts", {info.mercs, info.civs, info.enemies})
		.nums("alive", {info.aliveMercs, info.aliveCivs, info.aliveEnemies})
		.nums("classes", {info.admins, info.troops, info.elites})
		.num("defenceAdvantage", info.playerDefenceAdvantage)
		.flag("pendingSurrender", info.pendingSurrender)
		.flag("rejectedSurrender", info.rejectedSurrender)
		.flag("captureNotPermittedDueToEPCs", info.captureNotPermittedDueToEPCs)
		.num("robotCell", info.robotCell)
		.num("robotController", info.robotController)
		.text();
}

std::string DescribeArCells()
{
	std::vector<std::string> cells;
	for (int side = 0; side < AR_SIDES; ++side)
	{
		OracleARCellInfo cell{};
		for (int index = 0; OracleAutoResolveCell(side, index, cell); ++index)
		{
			std::vector<std::string> attackers;
			for (auto const& a : cell.attacker) attackers.push_back(a[0] < 0 ? "null" : "[" + std::to_string(a[0]) + "," + std::to_string(a[1]) + "]");
			cells.push_back(Json{}
				.num("side", side)
				.num("index", index)
				.num("flags", cell.flags)
				.num("attack", cell.attack)
				.num("defence", cell.defence)
				.num("nextAttack", cell.nextAttack)
				.nums("nextHit", {cell.nextHit[0], cell.nextHit[1], cell.nextHit[2]})
				.nums("hitDamage", {cell.hitDamage[0], cell.hitDamage[1], cell.hitDamage[2]})
				.raw("attackers", JsonArray(attackers))
				.num("weaponSlot", cell.weaponSlot)
				.raw("soldier", DescribeArSoldier(*cell.soldier))
				.text());
		}
	}
	return JsonArray(cells);
}

std::string DescribeDraws(std::vector<OracleDraw> const& draws)
{
	std::string out = "[";
	for (size_t i = 0; i < draws.size(); ++i)
	{
		if (i) out += ",";
		OracleDraw const& d = draws[i];
		out += "[\"" + std::string(1, d.stream) + "\"," + std::to_string(d.range) + "," + std::to_string(d.value) + "," + std::to_string(d.index) + "]";
	}
	return out + "]";
}

struct RetreatOrder
{
	UINT32    slice;
	long long soldier;
};

std::vector<RetreatOrder> RetreatOrders(Command const& c)
{
	std::vector<RetreatOrder> orders;
	for (std::string const& part : SplitList(Text(c, "retreat", ""), ','))
	{
		auto const colon = part.find(':');
		if (colon == std::string::npos) throw std::runtime_error("retreat entries look like <slice>:<soldier id>|all");
		std::string const who = part.substr(colon + 1);
		orders.push_back({static_cast<UINT32>(ParseInteger("retreat", part.substr(0, colon))), who == "all" ? -1 : ParseInteger("retreat", who)});
	}
	std::stable_sort(orders.begin(), orders.end(), [](RetreatOrder const& a, RetreatOrder const& b) { return a.slice < b.slice; });
	return orders;
}

INT32 MercCellOf(long long soldier)
{
	if (soldier < 0) return -1;
	OracleARCellInfo cell{};
	for (int index = 0; OracleAutoResolveCell(0, index, cell); ++index)
	{
		if (cell.soldier->ubID == soldier) return index;
	}
	throw std::runtime_error("soldier " + std::to_string(soldier) + " has no merc cell");
}

std::string DescribeCommand(char const* kind, UINT32 slice, long long who)
{
	return Json{}.str("kind", kind).num("slice", slice).num("who", who).text();
}

void ApplyPostAutoResolveMessages(SGPSector const& sector)
{
	if (gsCiviliansEatenByMonsters >= 1)
	{
		AdjustLoyaltyForCivsEatenByMonsters(SGPSector(gsEnemyGainedControlOfSectorID), static_cast<UINT8>(gsCiviliansEatenByMonsters));
	}
	else if (gsEnemyGainedControlOfSectorID >= 0)
	{
		SetThisSectorAsEnemyControlled(SGPSector(gsEnemyGainedControlOfSectorID));
	}
	gsCiviliansEatenByMonsters = -1;
	gsEnemyGainedControlOfSectorID = -1;
	(void)sector;
}

std::string DescribeTownLoyalty(SGPSector const& sector)
{
	UINT8 const town = GetTownIdForSector(sector);
	if (town == AR_NO_TOWN) return "null";
	return Json{}.num("town", town).num("rating", gTownLoyalty[town].ubRating).num("change", gTownLoyalty[town].sChange).text();
}

void RunAutoResolve(Command const& c)
{
	if (!gAutoResolveSetup.ready) throw std::runtime_error("autoresolve needs arsetup first");
	SGPSector const sector = gAutoResolveSetup.sector;
	bool const trace = Integer(c, "trace", 1) != 0;
	bool const acceptSurrender = Text(c, "surrender", "reject") == "accept";
	bool const bandage = Integer(c, "bandage", 0) != 0;
	UINT32 const maxSlices = static_cast<UINT32>(Integer(c, "maxSlices", DEFAULT_AR_MAX_SLICES));
	std::vector<RetreatOrder> const orders = RetreatOrders(c);
	std::vector<std::string> commands;

	gAutoResolveDraws.clear();
	if (trace) OracleTraceRandom(&gAutoResolveDraws);
	ScreenID const savedScreen = guiCurrentScreen;
	guiCurrentScreen = AUTORESOLVE_SCREEN;
	std::string const before = DescribeEnemyCounts(sector);
	std::string const loyaltyBefore = DescribeTownLoyalty(sector);
	UINT16 const killsBefore = gStrategicStatus.usPlayerKills;
	UINT32 const day = GetWorldDay();
	bool const capturedForRescue = (gStrategicStatus.uiFlags & STRATEGIC_PLAYER_CAPTURED_FOR_RESCUE) != 0;
	OracleTraceMark(AR_MARK_SETUP);
	OracleAutoResolveEnter(sector);
	std::string const setup = DescribeArCells();
	std::string const setupInfo = DescribeArInfo();
	OracleTraceMark(AR_MARK_RATINGS);
	OracleAutoResolveRate();
	std::string const ratings = DescribeArCells();
	std::string const ratingsInfo = DescribeArInfo();
	OracleTraceMark(AR_MARK_BATTLE);
	size_t next = 0;
	for (int loop = 0; loop < AR_MAX_LOOP; ++loop)
	{
		OracleARInfo info{};
		OracleAutoResolveInfo(info);
		if (info.status != 0) break;
		if (info.pendingSurrender)
		{
			OracleTraceMark(AR_MARK_SURRENDER);
			OracleAutoResolveSurrender(acceptSurrender);
			commands.push_back(DescribeCommand(acceptSurrender ? "accept" : "reject", info.slices, -1));
			continue;
		}
		while (next < orders.size() && orders[next].slice <= info.slices)
		{
			OracleTraceMark(AR_MARK_RETREAT);
			OracleAutoResolveRetreat(MercCellOf(orders[next].soldier));
			commands.push_back(DescribeCommand("retreat", info.slices, orders[next].soldier));
			++next;
		}
		UINT32 const budget = next < orders.size() ? std::min(orders[next].slice, maxSlices) : maxSlices;
		if (OracleAutoResolveRun(budget) >= maxSlices) break;
	}
	std::string const battle = DescribeArInfo();
	OracleTraceMark(AR_MARK_END);
	OracleAutoResolveBattleEnd();
	std::string const ended = DescribeArInfo();
	bool bandaged = false;
	if (bandage && OracleAutoResolveCanBandage())
	{
		OracleTraceMark(AR_MARK_BANDAGE);
		OracleAutoResolveBandage();
		bandaged = true;
	}
	std::string const afterBandage = DescribeArInfo();
	std::string const cells = DescribeArCells();
	UINT32 const worldBefore = GetWorldTotalSeconds();
	OracleTraceMark(AR_MARK_CLOSE);
	OracleAutoResolveClose();
	UINT32 const worldAfter = GetWorldTotalSeconds();
	std::string const promotions = Json{}.nums("promotions", {gbGreenToRegPromotions, gbRegToElitePromotions, gbGreenToElitePromotions, gbMilitiaPromotions}).text();
	OracleTraceMark(AR_MARK_POST);
	ApplyPostAutoResolveMessages(sector);
	OracleTraceMark(AR_MARK_DONE);
	OracleTraceRandom(nullptr);
	guiCurrentScreen = savedScreen;
	Emit(Json{}
		.str("probe", "autoresolve")
		.num("line", c.line)
		.str("sector", sector.AsShortString().to_std_string())
		.num("code", gubEnemyEncounterCode)
		.num("day", day)
		.flag("playerCapturedForRescue", capturedForRescue)
		.raw("countsBefore", before)
		.raw("setupInfo", setupInfo)
		.raw("setup", setup)
		.raw("ratingsInfo", ratingsInfo)
		.raw("ratings", ratings)
		.raw("commands", JsonArray(commands))
		.raw("result", Json{}
			.raw("battle", battle)
			.raw("ended", ended)
			.flag("bandaged", bandaged)
			.raw("afterBandage", afterBandage)
			.raw("cells", cells)
			.num("worldSecondsBefore", worldBefore)
			.num("worldSecondsAfter", worldAfter)
			.num("playerKills", gStrategicStatus.usPlayerKills - killsBefore)
			.raw("militiaPromotions", promotions)
			.raw("countsAfter", DescribeEnemyCounts(sector))
			.raw("loyaltyBefore", loyaltyBefore)
			.raw("loyaltyAfter", DescribeTownLoyalty(sector))
			.text())
		.raw("draws", DescribeDraws(gAutoResolveDraws)));
	gAutoResolveDraws.clear();
}

constexpr int ECONOMY_TOWNS = NUM_TOWNS;
constexpr int TRAINABLE_STATS = 9;

std::string DescribeTownLoyalties()
{
	std::vector<std::string> towns;
	for (int t = 0; t < ECONOMY_TOWNS; ++t)
	{
		TOWN_LOYALTY const& l = gTownLoyalty[t];
		towns.push_back(Json{}
			.num("rating", l.ubRating)
			.num("change", l.sChange)
			.flag("started", l.fStarted)
			.flag("liberated", l.fLiberatedAlready)
			.num("underControl", t ? GetTownSectorsUnderControl(static_cast<INT8>(t)) : 0)
			.text());
	}
	return JsonArray(towns);
}

std::string DescribeMilitiaSectors()
{
	std::vector<std::string> sectors;
	for (int id = 0; id < STRATEGIC_SECTORS; ++id)
	{
		SGPSector const s(static_cast<UINT8>(id));
		bool const sam = IsThisSectorASAMSector(s);
		if (!sam && StrategicMap[s.AsStrategicIndex()].bNameId == BLANK_SECTOR) continue;
		SECTORINFO const& si = SectorInfo[id];
		sectors.push_back(Json{}
			.num("sector", id)
			.nums("militia", {si.ubNumberOfCivsAtLevel[0], si.ubNumberOfCivsAtLevel[1], si.ubNumberOfCivsAtLevel[2]})
			.flag("paid", si.fMilitiaTrainingPaid)
			.num("percent", si.ubMilitiaTrainingPercentDone)
			.num("hundredths", si.ubMilitiaTrainingHundredths)
			.flag("everControlled", si.fSurfaceWasEverPlayerControlled)
			.flag("enemyControlled", StrategicMap[s.AsStrategicIndex()].fEnemyControlled)
			.flag("oursAndPeaceful", SectorOursAndPeaceful(s))
			.flag("trainingAllowed", MilitiaTrainingAllowedInSector(s))
			.flag("areaFull", IsAreaFullOfMilitia(s))
			.num("samCondition", StrategicMap[s.AsStrategicIndex()].bSAMCondition)
			.text());
	}
	return JsonArray(sectors);
}

std::string DescribeMines()
{
	std::vector<std::string> mines;
	for (size_t i = 0; i < gMineStatus.size(); ++i)
	{
		MINE_STATUS_TYPE const& m = gMineStatus[i];
		mines.push_back(Json{}
			.num("type", m.ubMineType)
			.num("maxRemovalRate", m.uiMaxRemovalRate)
			.num("remaining", m.uiRemainingOreSupply)
			.num("runningOutPoint", m.uiOreRunningOutPoint)
			.flag("empty", m.fEmpty)
			.flag("runningOut", m.fRunningOut)
			.flag("warned", m.fWarnedOfRunningOut)
			.flag("permanentShutDown", m.fShutDownIsPermanent)
			.flag("shutDown", m.fShutDown)
			.flag("prevInvaded", m.fPrevInvadedByMonsters)
			.flag("spokeToHeadMiner", m.fSpokeToHeadMiner)
			.flag("produced", m.fMineHasProducedForPlayer)
			.flag("queenRetook", m.fQueenRetookProducingMine)
			.flag("attackedHeadMiner", m.fAttackedHeadMiner)
			.num("productionStarted", m.uiTimePlayerProductionStarted)
			.num("predictedDaily", PredictDailyIncomeFromAMine(static_cast<INT8>(i)))
			.num("maxDaily", GetMaxDailyRemovalFromMine(static_cast<UINT8>(i)))
			.text());
	}
	return JsonArray(mines);
}

void DumpStrategicEconomy(Command const& c)
{
	std::vector<long long> air;
	for (int id = 0; id < STRATEGIC_SECTORS; ++id) air.push_back(StrategicMap[SGPSector(static_cast<UINT8>(id)).AsStrategicIndex()].fEnemyAirControlled);
	Emit(Json{}
		.str("probe", "strategic")
		.num("line", c.line)
		.num("worldMinutes", GetWorldTotalMin())
		.num("balance", LaptopSaveInfo.iCurrentBalance)
		.raw("towns", DescribeTownLoyalties())
		.raw("sectors", DescribeMilitiaSectors())
		.raw("mines", DescribeMines())
		.nums("enemyAir", air)
		.num("predictedIncome", PredictIncomeFromPlayerMines())
		.num("maxIncome", CalcMaxPlayerIncomeFromMines())
		.num("highestProgress", gStrategicStatus.ubHighestProgress)
		.num("enricoEmailFlags", gStrategicStatus.usEnricoEmailFlags)
		.num("lastDayOfPlayerActivity", gStrategicStatus.usLastDayOfPlayerActivity)
		.num("newSectorsVisitedToday", gStrategicStatus.ubNumNewSectorsVisitedToday)
		.num("daysOfInactivity", gStrategicStatus.ubNumberOfDaysOfInactivity));
}

std::string PointsPair(long long points, long long max)
{
	return Numbers({points, max});
}

std::string DescribeMercEstimates(SOLDIERTYPE& s)
{
	UINT16 max = 0;
	UINT16 const heal = CalculateHealingPointsForDoctor(&s, &max, FALSE);
	std::string const healing = PointsPair(heal, max);
	max = 0;
	UINT8 const repair = CalculateRepairPointsForRepairman(&s, &max, FALSE);
	std::string const repairing = PointsPair(repair, max);
	max = 0;
	INT16 const town = GetTownTrainPtsForCharacter(&s, &max);
	std::string const militia = PointsPair(town, max);
	std::vector<std::string> self;
	std::vector<std::string> student;
	std::vector<std::string> instructor;
	bool const gunRange = s.sSector == SGPSector(GUN_RANGE_X, GUN_RANGE_Y, GUN_RANGE_Z);
	for (INT8 stat = 0; stat < TRAINABLE_STATS; ++stat)
	{
		max = 0;
		INT16 const p = GetSoldierTrainingPts(&s, stat, gunRange, &max);
		self.push_back(PointsPair(p, max));
		max = 0;
		INT16 const q = GetSoldierStudentPts(&s, stat, gunRange, &max);
		student.push_back(PointsPair(q, max));
		max = 0;
		INT16 const r = GetBonusTrainingPtsDueToInstructor(&s, nullptr, stat, gunRange, &max);
		instructor.push_back(PointsPair(r, max));
	}
	return Json{}
		.raw("doctor", healing)
		.raw("repair", repairing)
		.raw("townTraining", militia)
		.raw("selfTraining", JsonArray(self))
		.raw("studentTraining", JsonArray(student))
		.raw("instructor", JsonArray(instructor))
		.text();
}

void DumpStrategicMercs(Command const& c)
{
	std::vector<std::string> mercs;
	FOR_EACH_IN_TEAM(i, OUR_TEAM)
	{
		SOLDIERTYPE& s = *i;
		mercs.push_back(Json{}
			.num("id", s.ubID)
			.num("profile", s.ubProfile)
			.raw("sector", StrategicSector(s.sSector))
			.flag("betweenSectors", s.fBetweenSectors)
			.num("assignment", s.bAssignment)
			.num("trainStat", s.bTrainStat)
			.flag("asleep", s.fMercAsleep)
			.flag("collapsed", s.fMercCollapsedFlag)
			.flag("forcedAwake", s.fForcedToStayAwake)
			.flag("complainedThatTired", s.fComplainedThatTired)
			.flag("nothingToDo", s.fDoneAssignmentAndNothingToDoFlag)
			.num("breath", s.bBreath)
			.num("breathMax", s.bBreathMax)
			.num("life", s.bLife)
			.num("lifeMax", s.bLifeMax)
			.num("fractLife", s.sFractLife)
			.num("bleeding", s.bBleeding)
			.num("lastAssignmentChange", s.uiLastAssignmentChangeMin)
			.num("needForSleep", GetProfile(s.ubProfile).ubNeedForSleep)
			.raw("estimates", DescribeMercEstimates(s))
			.text());
	}
	Emit(Json{}.str("probe", "mercs").num("line", c.line).str("detail", Text(c, "detail", "strategic")).num("worldMinutes", GetWorldTotalMin()).raw("mercs", JsonArray(mercs)));
}

std::map<std::string, UINT8> const LOYALTY_EVENTS{
	{"BATTLE_WON", GLOBAL_LOYALTY_BATTLE_WON}, {"BATTLE_LOST", GLOBAL_LOYALTY_BATTLE_LOST},
	{"ENEMY_KILLED", GLOBAL_LOYALTY_ENEMY_KILLED}, {"NATIVE_KILLED", GLOBAL_LOYALTY_NATIVE_KILLED},
	{"GAIN_TOWN_SECTOR", GLOBAL_LOYALTY_GAIN_TOWN_SECTOR}, {"LOSE_TOWN_SECTOR", GLOBAL_LOYALTY_LOSE_TOWN_SECTOR},
	{"LIBERATE_WHOLE_TOWN", GLOBAL_LOYALTY_LIBERATE_WHOLE_TOWN}, {"ABANDON_MILITIA", GLOBAL_LOYALTY_ABANDON_MILITIA},
	{"GAIN_MINE", GLOBAL_LOYALTY_GAIN_MINE}, {"LOSE_MINE", GLOBAL_LOYALTY_LOSE_MINE},
	{"GAIN_SAM", GLOBAL_LOYALTY_GAIN_SAM}, {"LOSE_SAM", GLOBAL_LOYALTY_LOSE_SAM},
	{"QUEEN_BATTLE_WON", GLOBAL_LOYALTY_QUEEN_BATTLE_WON},
};

void ProbeLoyaltyEvent(Command const& c)
{
	std::string const name = Text(c, "event", "");
	auto const it = LOYALTY_EVENTS.find(name);
	if (it == LOYALTY_EVENTS.end()) throw std::runtime_error("unknown loyalty event " + name);
	SGPSector sector = StrategicSectorArgument(c, "sector");
	sector.z = static_cast<INT8>(Integer(c, "z", 0));
	std::string const before = DescribeTownLoyalties();
	HandleGlobalLoyaltyEvent(it->second, sector);
	Emit(Json{}
		.str("probe", "loyalty")
		.num("line", c.line)
		.str("event", name)
		.raw("sector", StrategicSector(sector))
		.raw("before", before)
		.raw("towns", DescribeTownLoyalties()));
}

void AssignMerc(Command const& c)
{
	SOLDIERTYPE& s = ExistingSoldier(Required(c, "who"));
	Assignments const kind = static_cast<Assignments>(Required(c, "kind"));
	RemoveCharacterFromSquads(&s);
	if (s.bAssignment != kind) SetTimeOfAssignmentChangeForMerc(&s);
	ChangeSoldiersAssignment(&s, kind);
	s.bTrainStat = static_cast<INT8>(Integer(c, "stat", s.bTrainStat));
	Emit(Json{}.str("probe", "assign").num("line", c.line).num("who", s.ubID).num("kind", kind).num("stat", s.bTrainStat).num("changeMinute", s.uiLastAssignmentChangeMin));
}

void WarpTime(Command const& c)
{
	UINT32 const seconds = static_cast<UINT32>(Required(c, "seconds"));
	UINT32 const start = GetWorldTotalSeconds();
	WarpGameTime(seconds, WARPTIME_PROCESS_EVENTS_NORMALLY);
	Emit(Json{}.str("probe", "warp").num("line", c.line).num("seconds", seconds).num("from", start).num("worldSeconds", GetWorldTotalSeconds()));
}

std::vector<OracleDraw> gSaiDraws;
bool gSaiDrawsOn = false;

template<typename Run>
std::string TracedSaiDraws(Run&& run)
{
	std::vector<OracleDraw> draws;
	OracleTraceRandom(&draws);
	run();
	OracleTraceRandom(gSaiDrawsOn ? &gSaiDraws : nullptr);
	return DescribeDraws(draws);
}

void ControlDraws(Command const& c)
{
	std::string const mode = Text(c, "mode", Text(c, "_0", "dump"));
	if (mode == "on")
	{
		gSaiDraws.clear();
		gSaiDrawsOn = true;
		OracleTraceRandom(&gSaiDraws);
	}
	else if (mode == "off")
	{
		gSaiDrawsOn = false;
		OracleTraceRandom(nullptr);
	}
	else if (mode != "dump")
	{
		throw std::runtime_error("draws needs on, off or dump");
	}
	Emit(Json{}.str("probe", "draws").num("line", c.line).str("mode", mode).raw("draws", mode == "dump" ? DescribeDraws(gSaiDraws) : "[]"));
	if (mode == "dump") gSaiDraws.clear();
}

void ProbeNewGame(Command const& c)
{
	gGameOptions.ubDifficultyLevel = static_cast<UINT8>(Integer(c, "difficulty", DIF_LEVEL_MEDIUM));
	gGameOptions.fSciFi = Integer(c, "scifi", 0) != 0;
	std::string const draws = TracedSaiDraws([] { SetupNewStrategicGame(); InitNewCampaign(); });
	Emit(Json{}
		.str("probe", "newgame")
		.num("line", c.line)
		.num("difficulty", gGameOptions.ubDifficultyLevel)
		.flag("sciFi", gGameOptions.fSciFi)
		.num("worldSeconds", GetWorldTotalSeconds())
		.raw("draws", draws));
}

void ProbeSaiEvaluate(Command const& c)
{
	bool const forceAwake = Integer(c, "awake", 0) != 0;
	if (forceAwake) gfQueenAIAwake = TRUE;
	std::string const draws = TracedSaiDraws([] { EvaluateQueenSituation(); });
	Emit(Json{}.str("probe", "saievaluate").num("line", c.line).flag("forceAwake", forceAwake).num("worldSeconds", GetWorldTotalSeconds()).raw("draws", draws));
}

void ProbeSaiCheck(Command const& c)
{
	SGPSector const sector = StrategicSectorArgument(c, Has(c, "sector") ? "sector" : "_0");
	std::string const draws = TracedSaiDraws([&] { CheckEnemyControlledSector(sector.AsByte()); });
	Emit(Json{}.str("probe", "saicheck").num("line", c.line).num("sector", sector.AsByte()).num("worldSeconds", GetWorldTotalSeconds()).raw("draws", draws));
}

void ProbeSaiWake(Command const& c)
{
	std::string const draws = TracedSaiDraws([] { WakeUpQueen(); });
	Emit(Json{}.str("probe", "saiwake").num("line", c.line).num("worldSeconds", GetWorldTotalSeconds()).raw("draws", draws));
}

std::string DescribeSaiSector(SECTORINFO const& s)
{
	return Numbers({s.ubGarrisonID, s.uiFlags, s.ubNumAdmins, s.ubNumTroops, s.ubNumElites, s.ubNumCreatures, s.ubAdminsInBattle,
		s.ubTroopsInBattle, s.ubElitesInBattle, s.ubCreaturesInBattle, s.uiTimeLastPlayerLiberated, s.ubNumberOfCivsAtLevel[GREEN_MILITIA],
		s.ubNumberOfCivsAtLevel[REGULAR_MILITIA], s.ubNumberOfCivsAtLevel[ELITE_MILITIA], s.bBloodCats, s.bBloodCatPlacements});
}

void DumpStrategicAI(Command const& c)
{
	std::vector<std::string> compositions;
	for (ARMY_COMPOSITION const& a : gArmyComp)
	{
		compositions.push_back(Numbers({a.iReadability, a.bPriority, a.bElitePercentage, a.bTroopPercentage, a.bAdminPercentage, a.bDesiredPopulation, a.bStartPopulation}));
	}
	std::vector<std::string> garrisons;
	std::vector<long long> denied;
	for (size_t i = 0; i < gGarrisonGroup.size(); ++i)
	{
		GARRISON_GROUP const& g = gGarrisonGroup[i];
		garrisons.push_back(Numbers({g.ubSectorID, g.ubComposition, g.bWeight, g.ubPendingGroupID}));
		denied.push_back(gubGarrisonReinforcementsDenied[i]);
	}
	std::vector<std::string> patrols;
	for (PATROL_GROUP const& p : gPatrolGroup)
	{
		patrols.push_back(Numbers({p.bSize, p.bPriority, p.ubSectorID[0], p.ubSectorID[1], p.ubSectorID[2], p.ubSectorID[3], p.bFillPermittedAfterDayMod100,
			p.ubGroupID, p.bWeight, p.ubPendingGroupID}));
	}
	std::vector<std::string> sectors;
	std::vector<long long> control;
	for (int id = 0; id < STRATEGIC_SECTORS; ++id)
	{
		sectors.push_back(DescribeSaiSector(SectorInfo[id]));
		StrategicMapElement const& e = StrategicMap[SGPSector(static_cast<UINT8>(id)).AsStrategicIndex()];
		control.push_back(e.fEnemyControlled ? 1 : 0);
	}
	std::vector<std::string> underground;
	for (UNDERGROUND_SECTORINFO const* u = gpUndergroundSectorInfoHead; u; u = u->next)
	{
		underground.push_back(Numbers({u->ubSector.x, u->ubSector.y, u->ubSector.z, u->ubNumAdmins, u->ubNumTroops, u->ubNumElites, u->ubNumCreatures,
			u->ubAdminsInBattle, u->ubTroopsInBattle, u->ubElitesInBattle, u->ubCreaturesInBattle}));
	}
	std::vector<std::string> groups;
	CFOR_EACH_GROUP(g) if (!g->fPlayer) groups.push_back(DescribeGroup(*g));
	std::vector<std::string> events;
	for (STRATEGICEVENT const* e = gpEventList; e; e = e->next)
	{
		switch (e->ubCallbackID)
		{
			case EVENT_EVALUATE_QUEEN_SITUATION:
			case EVENT_CHECK_ENEMY_CONTROLLED_SECTOR:
			case EVENT_GROUP_ARRIVAL:
			case EVENT_MEANWHILE:
				events.push_back(Numbers({e->uiTimeStamp, e->ubCallbackID, e->uiParam, e->uiTimeOffset, e->ubEventType}));
				break;
			default:
				break;
		}
	}
	STRATEGIC_STATUS const& st = gStrategicStatus;
	Emit(Json{}
		.str("probe", "sai")
		.num("line", c.line)
		.num("worldSeconds", GetWorldTotalSeconds())
		.num("difficulty", gGameOptions.ubDifficultyLevel)
		.raw("globals", Json{}
			.flag("extraElites", gfExtraElites)
			.num("forcePercentage", giForcePercentage)
			.num("alertness", giArmyAlertness)
			.num("alertnessDecay", giArmyAlertnessDecay)
			.num("awareBattles", gubNumAwareBattles)
			.flag("awake", gfQueenAIAwake)
			.num("reinforcementPool", giReinforcementPool)
			.num("reinforcementPoints", giReinforcementPoints)
			.num("requestPoints", giRequestPoints)
			.num("saiVersion", gubSAIVersion)
			.num("priorityPhase", gubQueenPriorityPhase)
			.flag("firstBattleMeanwhilePending", gfFirstBattleMeanwhileScenePending)
			.flag("massFortificationOrdered", gfMassFortificationOrdered)
			.num("minGroupSize", gubMinEnemyGroupSize)
			.num("graceHours", gubHoursGracePeriod)
			.num("playerBattleVictories", gusPlayerBattleVictories)
			.flag("useAlternateQueenPosition", gfUseAlternateQueenPosition)
			.text())
		.raw("compositions", JsonArray(compositions))
		.raw("garrisons", JsonArray(garrisons))
		.raw("denied", Numbers(denied))
		.raw("patrols", JsonArray(patrols))
		.raw("sectors", JsonArray(sectors))
		.raw("enemyControlled", Numbers(control))
		.raw("underground", JsonArray(underground))
		.raw("groups", JsonArray(groups))
		.raw("events", JsonArray(events))
		.raw("status", Json{}
			.num("flags", st.uiFlags)
			.num("highestProgress", st.ubHighestProgress)
			.num("playerKills", st.usPlayerKills)
			.text())
		.num("meanwhileFlags", uiMeanWhileFlags)
		.num("progress", CurrentPlayerProgressPercentage())
		.num("mineIncome", PredictIncomeFromPlayerMines())
		.num("maxMineIncome", CalcMaxPlayerIncomeFromMines()));
}

void ProbeSaiArrive(Command const& c)
{
	long long const count = Integer(c, "count", 1);
	std::vector<long long> arrived;
	std::string const draws = TracedSaiDraws([&] {
		for (long long k = 0; k < count; ++k)
		{
			GROUP* next = nullptr;
			FOR_EACH_GROUP(g)
			{
				if (g->fPlayer || !g->fBetweenSectors) continue;
				if (!next || g->uiArrivalTime < next->uiArrivalTime) next = g;
			}
			if (!next) break;
			UINT32 const arrival = next->uiArrivalTime * 60;
			if (arrival > GetWorldTotalSeconds()) WarpGameTime(arrival - GetWorldTotalSeconds(), WARPTIME_NO_PROCESSING_OF_EVENTS);
			arrived.push_back(next->ubGroupID);
			DeleteStrategicEvent(EVENT_GROUP_ARRIVAL, next->ubGroupID);
			GroupArrivedAtSector(*next, TRUE, FALSE);
		}
	});
	Emit(Json{}.str("probe", "saiarrive").num("line", c.line).raw("groups", Numbers(arrived)).num("worldSeconds", GetWorldTotalSeconds()).raw("draws", draws));
}

void ProbeDifficultyModifier(Command const& c)
{
	UINT8 const soldierClass = static_cast<UINT8>(Integer(c, "class", SOLDIER_CLASS_ARMY));
	SGPSector battle;
	if (!GetCurrentBattleSectorXYZ(battle)) throw std::runtime_error("diffmod needs a battle or a loaded sector");
	Emit(Json{}
		.str("probe", "diffmod")
		.num("line", c.line)
		.num("class", soldierClass)
		.num("modifier", CalcDifficultyModifier(soldierClass))
		.num("difficulty", gGameOptions.ubDifficultyLevel)
		.num("highestProgress", HighestPlayerProgressPercentage())
		.num("progress", CurrentPlayerProgressPercentage())
		.num("mineIncome", PredictIncomeFromPlayerMines())
		.num("maxMineIncome", CalcMaxPlayerIncomeFromMines())
		.raw("battleSector", StrategicSector(battle))
		.num("townId", GetTownIdForSector(battle))
		.num("palaceDistance", GetPythDistanceFromPalace(battle)));
}

std::map<std::string, UINT8> const TACTICAL_EXIT_DIRECTIONS{
	{"N", NORTH}, {"E", EAST}, {"S", SOUTH}, {"W", WEST},
};

std::map<std::string, INT8> const STRATEGIC_EXIT_DIRECTIONS{
	{"N", NORTH_STRATEGIC_MOVE}, {"E", EAST_STRATEGIC_MOVE}, {"S", SOUTH_STRATEGIC_MOVE}, {"W", WEST_STRATEGIC_MOVE},
};

std::map<std::string, UINT8> const INSERTION_SIDES{
	{"N", INSERTION_CODE_NORTH}, {"S", INSERTION_CODE_SOUTH}, {"E", INSERTION_CODE_EAST}, {"W", INSERTION_CODE_WEST},
};

SoldierKeys const EXIT_SOLDIER{"who", "from", "level", "stance", "team", "body", "facing", "player"};

constexpr INT8 EXIT_GRID_DIRECTION = -1;
constexpr INT16 MIRROR_NORTH_Y = 1520;
constexpr INT16 MIRROR_SOUTH_Y = 0;
constexpr INT16 MIRROR_EAST_X = 0;
constexpr INT16 MIRROR_WEST_X = 3160;
constexpr UINT32 UNSET_MINUTES = 0xFFFFFFFFu;

std::string EdgepointList(std::vector<INT16> const& points, UINT16 middle)
{
	return Json{}.num("middle", middle).nums("gridNos", std::vector<long long>(points.begin(), points.end())).text();
}

void DumpEdgepoints(Command const& c)
{
	bool const generate = Integer(c, "generate", 0) != 0;
	if (generate) GenerateMapEdgepoints();
	Emit(Json{}
		.str("probe", "edgepoints")
		.num("line", c.line)
		.flag("generated", generate)
		.str("sector", gWorldSector.AsShortString().to_std_string())
		.num("z", gWorldSector.z)
		.raw("primary", JsonArray({
			EdgepointList(gps1stNorthEdgepointArray, gus1stNorthEdgepointMiddleIndex),
			EdgepointList(gps1stEastEdgepointArray, gus1stEastEdgepointMiddleIndex),
			EdgepointList(gps1stSouthEdgepointArray, gus1stSouthEdgepointMiddleIndex),
			EdgepointList(gps1stWestEdgepointArray, gus1stWestEdgepointMiddleIndex)}))
		.raw("secondary", JsonArray({
			EdgepointList(gps2ndNorthEdgepointArray, gus2ndNorthEdgepointMiddleIndex),
			EdgepointList(gps2ndEastEdgepointArray, gus2ndEastEdgepointMiddleIndex),
			EdgepointList(gps2ndSouthEdgepointArray, gus2ndSouthEdgepointMiddleIndex),
			EdgepointList(gps2ndWestEdgepointArray, gus2ndWestEdgepointMiddleIndex)})));
}

void ProbeWalkOff(Command const& c)
{
	auto const probe = MakeSoldier(c, EXIT_SOLDIER);
	SOLDIERTYPE& s = probe->get();
	UINT8 const direction = Lookup(TACTICAL_EXIT_DIRECTIONS, c, "dir", "E");
	INT16 const gridNo = OraclePickGridNoNearestEdge(&s, direction);
	Emit(Json{}
		.str("probe", "walkoff")
		.num("line", c.line)
		.num("direction", direction)
		.raw("soldier", Describe(s))
		.num("gridNo", gridNo));
}

void ProbeWalkIn(Command const& c)
{
	auto const probe = MakeSoldier(c, EXIT_SOLDIER);
	SOLDIERTYPE& s = probe->get();
	UINT8 const code = Lookup(INSERTION_SIDES, c, "code", "W");
	UINT32 attempts = 0;
	INT16 const gridNo = OraclePickGridNoToWalkIn(&s, code, &attempts);
	Emit(Json{}
		.str("probe", "walkin")
		.num("line", c.line)
		.num("insertionCode", code)
		.raw("soldier", Describe(s))
		.num("gridNo", gridNo)
		.num("attempts", attempts));
}

void ProbeMirror(Command const& c)
{
	auto const probe = MakeSoldier(c, EXIT_SOLDIER);
	SOLDIERTYPE const& s = probe->get();
	UINT8 const direction = Lookup(TACTICAL_EXIT_DIRECTIONS, c, "dir", "E");
	INT16 x;
	INT16 y;
	GetAbsoluteScreenXYFromMapPos(GETWORLDINDEXFROMWORLDCOORDS(s.sY, s.sX), &x, &y);
	if (direction == NORTH) y = MIRROR_NORTH_Y;
	else if (direction == SOUTH) y = MIRROR_SOUTH_Y;
	else if (direction == EAST) x = MIRROR_EAST_X;
	else x = MIRROR_WEST_X;
	GridNo const mirror = GetMapPosFromAbsoluteScreenXY(x, y);
	gubTacticalDirection = direction;
	UINT8 const classCode = CalcMapEdgepointClassInsertionCode(s.sGridNo);
	Emit(Json{}
		.str("probe", "mirror")
		.num("line", c.line)
		.num("direction", direction)
		.raw("soldier", Describe(s))
		.num("gridNo", mirror)
		.num("classCode", classCode));
}

INT8 ExitDirectionArgument(Command const& c)
{
	return Has(c, "grid") ? EXIT_GRID_DIRECTION : Lookup(STRATEGIC_EXIT_DIRECTIONS, c, "dir", "E");
}

UINT16 ExitGridArgument(Command const& c)
{
	return Has(c, "grid") ? static_cast<UINT16>(GridArgument(c, "grid")) : 0;
}

void ProbeSoldierExit(Command const& c)
{
	auto const probe = MakeSoldier(c, EXIT_SOLDIER);
	SOLDIERTYPE& s = probe->get();
	INT8 const direction = ExitDirectionArgument(c);
	UINT16 const exitGrid = ExitGridArgument(c);
	INT16 x;
	INT16 y;
	GetAbsoluteScreenXYFromMapPos(s.sGridNo, &x, &y);
	BOOLEAN const ok = OracleSoldierOKForSectorExit(&s, direction, exitGrid);
	Emit(Json{}
		.str("probe", "soldierexit")
		.num("line", c.line)
		.num("exitDirection", direction)
		.num("exitGrid", exitGrid)
		.raw("soldier", Describe(s))
		.num("screenX", x)
		.num("screenY", y)
		.flag("ok", ok != FALSE));
}

void ProbeExitCheck(Command const& c)
{
	SOLDIERTYPE& selected = ExistingSoldier(Required(c, "who"));
	SetSelectedMan(&selected);
	iCurrentTacticalSquad = selected.bAssignment;
	INT8 const direction = ExitDirectionArgument(c);
	UINT16 const exitGrid = ExitGridArgument(c);
	UINT32 minutes = UNSET_MINUTES;
	BOOLEAN const result = OKForSectorExit(direction, exitGrid, &minutes);
	std::vector<std::string> soldiers;
	FOR_EACH_IN_TEAM(s, OUR_TEAM)
	{
		if (!s->bInSector) continue;
		soldiers.push_back(Numbers({s->ubID, s->bAssignment, OracleSoldierOKForSectorExit(s, direction, exitGrid) ? 1 : 0}));
	}
	Emit(Json{}
		.str("probe", "exitcheck")
		.num("line", c.line)
		.num("who", selected.ubID)
		.num("squad", iCurrentTacticalSquad)
		.num("exitDirection", direction)
		.num("exitGrid", exitGrid)
		.num("result", result)
		.num("minutes", minutes == UNSET_MINUTES ? -1 : static_cast<long long>(minutes))
		.flag("invalidTraversal", gfInvalidTraversal != FALSE)
		.flag("loneEpc", gfLoneEPCAttemptingTraversal != FALSE)
		.num("abandonedEpcs", gubLoneMercAttemptingToAbandonEPCs)
		.raw("soldiers", JsonArray(soldiers)));
}

void MoveSoldier(Command const& c)
{
	SOLDIERTYPE& s = ExistingSoldier(Required(c, "who"));
	EVENT_SetSoldierPositionNoCenter(&s, GridArgument(c, "to"), SSP_NONE);
	Emit(Json{}.str("probe", "move").num("line", c.line).num("who", s.ubID).num("gridNo", s.sGridNo));
}

std::string DescribeInitList()
{
	std::vector<std::string> nodes;
	CFOR_EACH_SOLDIERINITNODE(n)
	{
		BASIC_SOLDIERCREATE_STRUCT const& b = *n->pBasicPlacement;
		nodes.push_back(Numbers({n->ubNodeID, b.bTeam, b.ubSoldierClass, b.fPriorityExistance ? 1 : 0, n->pDetailedPlacement ? 1 : 0,
			n->pSoldier ? n->pSoldier->ubID : -1, n->pSoldier ? n->pSoldier->ubSoldierClass : -1}));
	}
	return JsonArray(nodes);
}

void ProbeInitList(Command const& c)
{
	std::string const before = DescribeInitList();
	OracleSortSoldierInitList();
	Emit(Json{}.str("probe", "initlist").num("line", c.line).raw("before", before).raw("sorted", DescribeInitList()));
}

void ProbeDefence(Command const& c)
{
	UINT8 const admins = static_cast<UINT8>(Integer(c, "admins", 0));
	UINT8 const troops = static_cast<UINT8>(Integer(c, "troops", 0));
	UINT8 const elites = static_cast<UINT8>(Integer(c, "elites", 0));
	std::string const before = DescribeInitList();
	std::string const draws = TracedSaiDraws([&] { AddSoldierInitListEnemyDefenceSoldiers(admins, troops, elites); });
	Emit(Json{}
		.str("probe", "defence")
		.num("line", c.line)
		.num("admins", admins)
		.num("troops", troops)
		.num("elites", elites)
		.raw("before", before)
		.raw("nodes", DescribeInitList())
		.raw("draws", draws));
}


std::string DescribeCreatureEvents()
{
	std::vector<std::string> events;
	for (STRATEGICEVENT const* e = gpEventList; e; e = e->next)
	{
		if (e->ubCallbackID != EVENT_CREATURE_SPREAD && e->ubCallbackID != EVENT_CREATURE_NIGHT_PLANNING && e->ubCallbackID != EVENT_CREATURE_ATTACK) continue;
		events.push_back(Json{}.num("kind", e->ubCallbackID).num("stamp", e->uiTimeStamp).num("param", e->uiParam).num("type", e->ubEventType).num("offset", e->uiTimeOffset).text());
	}
	return JsonArray(events);
}

std::string DescribeCreatures()
{
	std::vector<std::string> underground;
	for (UNDERGROUND_SECTORINFO const* u = gpUndergroundSectorInfoHead; u; u = u->next)
	{
		underground.push_back(Numbers({u->ubSector.AsByte(), u->ubSector.z, u->ubNumCreatures, u->ubCreatureHabitat, u->uiFlags, u->ubCreaturesInBattle}));
	}
	std::vector<std::string> surface;
	for (UINT32 id = 0; id < 256; ++id)
	{
		SECTORINFO const& si = SectorInfo[id];
		if (!si.ubNumCreatures && !si.ubCreaturesInBattle && !si.ubDayOfLastCreatureAttack) continue;
		surface.push_back(Numbers({id, si.ubNumCreatures, si.ubCreaturesInBattle, si.ubDayOfLastCreatureAttack}));
	}
	std::vector<long long> mines;
	for (UINT8 m = 0; m < gMineStatus.size(); ++m) mines.push_back(MineClearOfMonsters(m) ? 1 : 0);
	return Json{}
		.num("lairId", giLairID)
		.num("habitatedDistance", giHabitatedDistance)
		.num("populationModifier", giPopulationModifier)
		.num("destroyedLairId", giDestroyedLairID)
		.flag("meanwhilePlayed", gfCreatureMeanwhileScenePlayed)
		.raw("underground", JsonArray(underground))
		.raw("surface", JsonArray(surface))
		.raw("events", DescribeCreatureEvents())
		.raw("attack", Numbers({gsCreatureInsertionCode, gsCreatureInsertionGridNo, gubNumCreaturesAttackingTown, gubCreatureBattleCode, gubSectorIDOfCreatureAttack}))
		.raw("mineClear", Numbers(mines))
		.flag("infested", PlayerGroupIsInACreatureInfestedMine())
		.num("meanwhileFlags", uiMeanWhileFlags)
		.flag("gameScreen", guiCurrentScreen == GAME_SCREEN)
		.flag("enemyInLoadedSector", gfWorldLoaded && gTacticalStatus.fEnemyInSector)
		.num("worldMinutes", GetWorldTotalMin())
		.text();
}

void SetSectorControl(Command const& c)
{
	SGPSector const sector = StrategicSectorArgument(c, Has(c, "sector") ? "sector" : "_0");
	StrategicMap[sector.AsStrategicIndex()].fEnemyControlled = Integer(c, "enemy", 0) != 0;
	Emit(Json{}.str("probe", "setcontrol").num("line", c.line).num("sector", sector.AsByte()).flag("enemy", StrategicMap[sector.AsStrategicIndex()].fEnemyControlled));
}

void SetTacticalFlags(Command const& c)
{
	if (Has(c, "enemyinsector")) gTacticalStatus.fEnemyInSector = Integer(c, "enemyinsector", 0) != 0;
	Emit(Json{}.str("probe", "tacticalflags").num("line", c.line).flag("enemyInSector", gTacticalStatus.fEnemyInSector));
}

std::string DescribeArgs(Command const& c)
{
	Json args;
	for (auto const& [key, value] : c.args) args.str(key.c_str(), value);
	return args.text();
}

void EmitCreatureProbe(Command const& c, char const* name, std::string const& draws)
{
	Emit(Json{}.str("probe", name).num("line", c.line).raw("args", DescribeArgs(c)).raw("draws", draws).raw("creatures", DescribeCreatures()));
}

void SetGameOption(Command const& c)
{
	if (Has(c, "scifi")) gGameOptions.fSciFi = Integer(c, "scifi", 0) != 0;
	if (Has(c, "difficulty")) gGameOptions.ubDifficultyLevel = static_cast<UINT8>(Integer(c, "difficulty", DIF_LEVEL_MEDIUM));
	if (Has(c, "gunnut")) gGameOptions.fGunNut = Integer(c, "gunnut", 0) != 0;
	Emit(Json{}.str("probe", "options").num("line", c.line).flag("sciFi", gGameOptions.fSciFi).num("difficulty", gGameOptions.ubDifficultyLevel)
		.flag("gunNut", gGameOptions.fGunNut));
}

void DumpCreatures(Command const& c)
{
	EmitCreatureProbe(c, "creatures", "[]");
}

void ProbeCreatureQuest(Command const& c)
{
	EmitCreatureProbe(c, "creaturequest", TracedSaiDraws([] { InitCreatureQuest(); }));
}

void ProbeCreatureTrigger(Command const& c)
{
	EmitCreatureProbe(c, "creaturetrigger", TracedSaiDraws([] { CheckConditionsForTriggeringCreatureQuest(); }));
}

void ProbeCreatureSpread(Command const& c)
{
	long long const count = Integer(c, "count", 1);
	EmitCreatureProbe(c, "creaturespread", TracedSaiDraws([&] { for (long long i = 0; i < count; ++i) SpreadCreatures(); }));
}

void ProbeCreaturePlanning(Command const& c)
{
	EmitCreatureProbe(c, "creatureplanning", TracedSaiDraws([] { CreatureNightPlanning(); }));
}

void ProbeCreatureAttack(Command const& c)
{
	SGPSector const sector = StrategicSectorArgument(c, Has(c, "sector") ? "sector" : "_0");
	bool const specific = Integer(c, "specific", 0) != 0;
	gOracleSkipCreatureBattle = true;
	std::string const draws = TracedSaiDraws([&] { CreatureAttackTown(sector.AsByte(), specific); });
	gOracleSkipCreatureBattle = false;
	EmitCreatureProbe(c, "creatureattack", draws);
}

void ProbeEndCreatureQuest(Command const& c)
{
	EndCreatureQuest();
	EmitCreatureProbe(c, "endcreaturequest", "[]");
}

void SetCreatures(Command const& c)
{
	SGPSector sector = StrategicSectorArgument(c, Has(c, "sector") ? "sector" : "_0");
	sector.z = static_cast<INT8>(Integer(c, "z", 0));
	UINT8 const count = static_cast<UINT8>(Required(c, "count"));
	if (sector.z == 0)
	{
		SectorInfo[sector.AsByte()].ubNumCreatures = count;
	}
	else
	{
		UNDERGROUND_SECTORINFO* const u = FindUnderGroundSector(sector);
		if (!u) throw std::runtime_error("setcreatures: no such underground sector");
		u->ubNumCreatures = count;
	}
	EmitCreatureProbe(c, "setcreatures", "[]");
}

void ProbeCreatureComposition(Command const& c)
{
	UINT8 const count = static_cast<UINT8>(Required(c, "count"));
	UINT8 ym = 0, yf = 0, am = 0, af = 0;
	std::string const draws = TracedSaiDraws([&] { DetermineCreatureTownComposition(count, &ym, &yf, &am, &af); });
	Emit(Json{}.str("probe", "creaturecomposition").num("line", c.line).num("count", count).raw("composition", Numbers({ym, yf, am, af})).raw("draws", draws));
}

std::string DescribeMoraleMercs()
{
	std::vector<std::string> mercs;
	FOR_EACH_IN_TEAM(i, OUR_TEAM)
	{
		SOLDIERTYPE const& s = *i;
		std::vector<long long> opinions;
		std::vector<long long> hatedCount;
		std::vector<long long> hatedTime;
		std::vector<long long> hated;
		std::vector<long long> buddies;
		if (s.ubProfile != NO_PROFILE)
		{
			MERCPROFILESTRUCT const& p = GetProfile(s.ubProfile);
			CFOR_EACH_IN_TEAM(o, OUR_TEAM)
			{
				if (o->ubProfile == NO_PROFILE || o->ubProfile >= NUM_PROFILES) continue;
				opinions.push_back(o->ubProfile < lengthof(p.bMercOpinion) ? p.bMercOpinion[o->ubProfile] : 0);
			}
			for (int k = 0; k < 5; ++k)
			{
				hatedCount.push_back(p.bHatedCount[k]);
				hatedTime.push_back(p.bHatedTime[k]);
				hated.push_back(p.bHated[k]);
				buddies.push_back(p.bBuddy[k]);
			}
		}
		MERCPROFILESTRUCT const* const p = s.ubProfile != NO_PROFILE ? &GetProfile(s.ubProfile) : nullptr;
		mercs.push_back(Json{}
			.num("id", s.ubID)
			.num("profile", s.ubProfile)
			.raw("sector", StrategicSector(s.sSector))
			.flag("betweenSectors", s.fBetweenSectors)
			.num("group", s.ubGroupID)
			.flag("inMotion", s.ubGroupID != 0 && PlayerIDGroupInMotion(s.ubGroupID))
			.num("assignment", s.bAssignment)
			.flag("asleep", s.fMercAsleep)
			.flag("inSector", s.bInSector)
			.num("life", s.bLife)
			.num("leadership", EffectiveLeadership(&s))
			.num("morale", s.bMorale)
			.nums("mods", {s.bTeamMoraleMod, s.bTacticalMoraleMod, s.bStrategicMoraleMod, s.bDelayedStrategicMoraleMod})
			.raw("opinions", Numbers(opinions))
			.raw("hated", Numbers(hated))
			.raw("hatedTime", Numbers(hatedTime))
			.raw("hatedCount", Numbers(hatedCount))
			.raw("buddies", Numbers(buddies))
			.nums("learn", {p ? p->bLearnToHate : 0, p ? p->bLearnToHateTime : 0, p ? p->bLearnToHateCount : 0, p ? p->bLearnToLike : 0,
				p ? p->bLearnToLikeTime : 0, p ? p->bLearnToLikeCount : 0, p ? p->ubTimeTillNextHatedComplaint : 0})
			.num("personality", p ? p->bPersonalityTrait : 0)
			.num("attitude", p ? p->bAttitude : 0)
			.text());
	}
	return JsonArray(mercs);
}

void DumpMorale(Command const& c)
{
	Emit(Json{}
		.str("probe", c.name)
		.num("line", c.line)
		.raw("args", DescribeArgs(c))
		.num("counter", gOracleStrategicMoraleUpdateCounter)
		.num("progress", CurrentPlayerProgressPercentage())
		.flag("enemyInSector", gTacticalStatus.fEnemyInSector)
		.num("worldMinutes", GetWorldTotalMin())
		.raw("mercs", DescribeMoraleMercs()));
}

void SetMorale(Command const& c)
{
	SOLDIERTYPE& s = GetMan(static_cast<SoldierID>(Required(c, "who")));
	if (Has(c, "team")) s.bTeamMoraleMod = static_cast<INT8>(Integer(c, "team", 0));
	if (Has(c, "tactical")) s.bTacticalMoraleMod = static_cast<INT8>(Integer(c, "tactical", 0));
	if (Has(c, "strategic")) s.bStrategicMoraleMod = static_cast<INT8>(Integer(c, "strategic", 0));
	if (Has(c, "delayed")) s.bDelayedStrategicMoraleMod = static_cast<INT8>(Integer(c, "delayed", 0));
	if (Has(c, "asleep")) s.fMercAsleep = Integer(c, "asleep", 0) != 0;
	RefreshSoldierMorale(&s);
	DumpMorale(c);
}

std::vector<long long> TripleArgument(Command const& c, std::string const& key)
{
	std::vector<std::string> const parts = SplitList(Text(c, key, ""), ':');
	std::vector<long long> values;
	for (std::string const& part : parts) values.push_back(ParseInteger(key, part));
	return values;
}

void SetRelation(Command const& c)
{
	MERCPROFILESTRUCT& p = GetProfile(static_cast<ProfileID>(Required(c, "who")));
	INT8 const about = static_cast<INT8>(Required(c, "about"));
	if (Has(c, "opinion")) p.bMercOpinion[about] = static_cast<INT8>(Integer(c, "opinion", 0));
	if (Has(c, "hated"))
	{
		std::vector<long long> const v = TripleArgument(c, "hated");
		if (v.size() != 3) throw std::runtime_error("hated needs slot:time:count");
		p.bHated[v[0]] = about;
		p.bHatedTime[v[0]] = static_cast<INT8>(v[1]);
		p.bHatedCount[v[0]] = static_cast<INT8>(v[2]);
	}
	if (Has(c, "learnhate"))
	{
		std::vector<long long> const v = TripleArgument(c, "learnhate");
		if (v.size() != 2) throw std::runtime_error("learnhate needs time:count");
		p.bLearnToHate = about;
		p.bLearnToHateTime = static_cast<INT8>(v[0]);
		p.bLearnToHateCount = static_cast<INT8>(v[1]);
	}
	if (Has(c, "learnlike"))
	{
		std::vector<long long> const v = TripleArgument(c, "learnlike");
		if (v.size() != 2) throw std::runtime_error("learnlike needs time:count");
		p.bLearnToLike = about;
		p.bLearnToLikeTime = static_cast<INT8>(v[0]);
		p.bLearnToLikeCount = static_cast<INT8>(v[1]);
	}
	DumpMorale(c);
}

void SetProfileTraits(Command const& c)
{
	MERCPROFILESTRUCT& p = GetProfile(static_cast<ProfileID>(Required(c, "who")));
	if (Has(c, "personality")) p.bPersonalityTrait = static_cast<INT8>(Integer(c, "personality", 0));
	if (Has(c, "attitude")) p.bAttitude = static_cast<INT8>(Integer(c, "attitude", 0));
	DumpMorale(c);
}

void MoveForMorale(Command const& c)
{
	SOLDIERTYPE& s = GetMan(static_cast<SoldierID>(Required(c, "who")));
	EVENT_SetSoldierPositionNoCenter(&s, static_cast<INT16>(Required(c, "to")), SSP_NONE);
	DumpMorale(c);
}

void SetMoraleCounter(Command const& c)
{
	gOracleStrategicMoraleUpdateCounter = static_cast<INT8>(Integer(c, "value", 0));
	DumpMorale(c);
}

void ProbeHourlyMorale(Command const& c)
{
	long long const count = Integer(c, "count", 1);
	for (long long i = 0; i < count; ++i)
	{
		UpdateBuddyAndHatedCounters();
		HourlyMoraleUpdate();
	}
	DumpMorale(c);
}

void ProbeQuarterHourMorale(Command const& c)
{
	long long const count = Integer(c, "count", 1);
	for (long long i = 0; i < count; ++i) DecayTacticalMoraleModifiers();
	DumpMorale(c);
}

std::string DescribeCreatureInitList()
{
	std::vector<std::string> nodes;
	CFOR_EACH_SOLDIERINITNODE(n)
	{
		BASIC_SOLDIERCREATE_STRUCT const& b = *n->pBasicPlacement;
		nodes.push_back(Numbers({n->ubNodeID, b.bTeam, b.ubSoldierClass, b.fPriorityExistance ? 1 : 0, n->pDetailedPlacement ? 1 : 0,
			n->pSoldier ? n->pSoldier->ubID : -1, b.bBodyType, n->pSoldier ? n->pSoldier->ubBodyType : -1}));
	}
	return JsonArray(nodes);
}

void ProbeCreaturePlacement(Command const& c)
{
	bool const queen = Integer(c, "queen", 0) != 0;
	auto const n = [&](char const* key) { return static_cast<UINT8>(Integer(c, key, 0)); };
	std::string const before = DescribeCreatureInitList();
	std::string const draws = TracedSaiDraws([&] { AddSoldierInitListCreatures(queen, n("larvae"), n("infants"), n("ym"), n("yf"), n("am"), n("af")); });
	Emit(Json{}
		.str("probe", "creatureplacement")
		.num("line", c.line)
		.flag("queen", queen)
		.raw("counts", Numbers({n("larvae"), n("infants"), n("ym"), n("yf"), n("am"), n("af")}))
		.raw("before", before)
		.raw("nodes", DescribeCreatureInitList())
		.raw("draws", draws));
}

void ProbeBloodcatPlacement(Command const& c)
{
	SECTORINFO& si = SectorInfo[gWorldSector.AsByte()];
	if (Has(c, "cats")) si.bBloodCats = static_cast<INT8>(Integer(c, "cats", 0));
	if (Has(c, "placements")) si.bBloodCatPlacements = static_cast<INT8>(Integer(c, "placements", 0));
	INT8 const catsIn = si.bBloodCats;
	INT8 const placementsIn = si.bBloodCatPlacements;
	std::string const before = DescribeCreatureInitList();
	std::string const draws = TracedSaiDraws([] { AddSoldierInitListBloodcats(); });
	Emit(Json{}
		.str("probe", "bloodcatplacement")
		.num("line", c.line)
		.num("sector", gWorldSector.AsByte())
		.nums("in", {catsIn, placementsIn})
		.nums("out", {si.bBloodCats, si.bBloodCatPlacements})
		.raw("before", before)
		.raw("nodes", DescribeCreatureInitList())
		.raw("draws", draws));
}

std::string DescribeDealerSpecial(DEALER_SPECIAL_ITEM const& s)
{
	SPECIAL_ITEM_INFO const& i = s.Info;
	return Numbers({s.fActive ? 1 : 0, i.bItemCondition, i.ubImprintID,
		i.usAttachment[0], i.usAttachment[1], i.usAttachment[2], i.usAttachment[3],
		i.bAttachmentStatus[0], i.bAttachmentStatus[1], i.bAttachmentStatus[2], i.bAttachmentStatus[3],
		static_cast<long long>(s.uiRepairDoneTime), s.ubOwnerProfileId});
}

std::string DescribeDealerItems(ArmsDealerID const dealer)
{
	std::vector<std::string> items;
	for (UINT16 item = 0; item < MAXITEMS; ++item)
	{
		DEALER_ITEM_HEADER const& h = gArmsDealersInventory[dealer][item];
		bool const empty = h.ubTotalItems == 0 && h.ubPerfectItems == 0 && h.ubStrayAmmo == 0 && h.uiOrderArrivalTime == 0 &&
			h.ubQtyOnOrder == 0 && !h.fPreviouslyEligible && h.SpecialItem.empty();
		if (empty) continue;
		std::vector<std::string> specials;
		for (DEALER_SPECIAL_ITEM const& s : h.SpecialItem) specials.push_back(DescribeDealerSpecial(s));
		items.push_back("[" + std::to_string(item) + "," + std::to_string(h.ubTotalItems) + "," + std::to_string(h.ubPerfectItems) + "," +
			std::to_string(h.ubStrayAmmo) + "," + std::to_string(h.uiOrderArrivalTime) + "," + std::to_string(h.ubQtyOnOrder) + "," +
			std::to_string(h.fPreviouslyEligible ? 1 : 0) + "," + JsonArray(specials) + "]");
	}
	return JsonArray(items);
}

std::string DescribeDealers()
{
	std::vector<std::string> dealers;
	for (auto const* d : GCM->getDealers())
	{
		ARMS_DEALER_STATUS const& s = gArmsDealerStatus[d->dealerID];
		dealers.push_back(Json{}
			.num("cash", s.uiArmsDealersCash)
			.num("flags", s.ubSpecificDealerFlags)
			.flag("out", s.fOutOfBusiness)
			.flag("delayUsed", s.fRepairDelayBeenUsed)
			.flag("unused", s.fUnusedKnowsPlayer)
			.num("lastSki", s.uiTimePlayerLastInSKI)
			.raw("items", DescribeDealerItems(d->dealerID))
			.text());
	}
	return JsonArray(dealers);
}

Json DealerContext(char const* name, Command const& c)
{
	return Json{}
		.str("probe", name)
		.num("line", c.line)
		.num("worldDay", GetWorldDay())
		.num("worldMinutes", GetWorldTotalMin())
		.num("progress", gStrategicStatus.ubHighestProgress)
		.flag("gunNut", gGameOptions.fGunNut)
		.flag("estoni", CheckFact(FACT_ESTONI_REFUELLING_POSSIBLE, 0));
}

void DumpDealers(Command const& c)
{
	Emit(DealerContext("dealers", c).raw("dealers", DescribeDealers()));
}

void ProbeDealerInit(Command const& c)
{
	Json json = DealerContext("dealerinit", c);
	std::string const draws = TracedSaiDraws([] { InitAllArmsDealers(); });
	Emit(json.raw("draws", draws).raw("dealers", DescribeDealers()));
}

void ProbeDealerDaily(Command const& c)
{
	long long const count = Integer(c, "count", 1);
	for (long long day = 1; day <= count; ++day)
	{
		WarpGameTime(NUM_SEC_IN_DAY, WARPTIME_NO_PROCESSING_OF_EVENTS);
		Json json = DealerContext("dealerdaily", c);
		std::string const draws = TracedSaiDraws([] { DailyUpdateOfArmsDealersInventory(); });
		Emit(json.num("day", day).raw("draws", draws).raw("dealers", DescribeDealers()));
	}
}

void SetHighestProgress(Command const& c)
{
	gStrategicStatus.ubHighestProgress = static_cast<UINT8>(Required(c, "highest"));
	Emit(Json{}.str("probe", "progress").num("line", c.line).num("highest", gStrategicStatus.ubHighestProgress));
}

void SetFactProbe(Command const& c)
{
	Fact const id = static_cast<Fact>(Required(c, "id"));
	bool const value = Integer(c, "value", 1) != 0;
	std::string const draws = TracedSaiDraws([&] { if (value) SetFactTrue(id); else SetFactFalse(id); });
	Emit(Json{}.str("probe", "fact").num("line", c.line).num("id", id).flag("value", value).raw("draws", draws));
}

UINT16 ItemArgument(std::string const& name)
{
	if (!name.empty() && std::all_of(name.begin(), name.end(), [](char ch) { return ch >= '0' && ch <= '9'; }))
	{
		return static_cast<UINT16>(std::stoi(name));
	}
	ItemModel const* const item = GCM->getItemByName(ST::string(name.c_str()));
	if (!item) throw std::runtime_error("unknown item " + name);
	return item->getItemIndex();
}

std::pair<std::string, long long> SplitPair(std::string const& text)
{
	size_t const colon = text.find(':');
	if (colon == std::string::npos) throw std::runtime_error("expected <item>:<number>, got " + text);
	return {text.substr(0, colon), std::stoll(text.substr(colon + 1))};
}

OBJECTTYPE DealerProbeObject(Command const& c)
{
	UINT16 const item = ItemArgument(Text(c, "item", ""));
	INT8 const status = static_cast<INT8>(Integer(c, "status", 100));
	UINT8 const count = static_cast<UINT8>(Integer(c, "count", 1));
	OBJECTTYPE o;
	CreateItems(item, status, std::min<UINT8>(count, MAX_OBJECTS_PER_SLOT), &o);
	if (count > MAX_OBJECTS_PER_SLOT) o.ubNumberOfObjects = count;
	if (Has(c, "ammo"))
	{
		auto const [ammo, rounds] = SplitPair(Text(c, "ammo", ""));
		o.usGunAmmoItem = ItemArgument(ammo);
		if (GCM->getItem(o.usGunAmmoItem)->getItemClass() == IC_AMMO) o.ubGunShotsLeft = static_cast<UINT8>(rounds);
		else o.bGunAmmoStatus = static_cast<INT8>(rounds);
	}
	if (Has(c, "imprint")) o.ubImprintID = static_cast<UINT8>(Integer(c, "imprint", NO_PROFILE));
	std::string const statuses = Text(c, "statuses", "");
	for (size_t at = 0, k = 0; at < statuses.size() && k < MAX_OBJECTS_PER_SLOT; ++k)
	{
		size_t const comma = statuses.find(',', at);
		o.bStatus[k] = static_cast<INT8>(std::stoi(statuses.substr(at, comma == std::string::npos ? std::string::npos : comma - at)));
		if (comma == std::string::npos) break;
		at = comma + 1;
	}
	std::string const attachments = Text(c, "attach", "");
	size_t start = 0;
	UINT8 slot = 0;
	while (start < attachments.size() && slot < MAX_ATTACHMENTS)
	{
		size_t const comma = attachments.find(',', start);
		std::string const part = attachments.substr(start, comma == std::string::npos ? std::string::npos : comma - start);
		auto const [name, value] = SplitPair(part);
		o.usAttachItem[slot] = ItemArgument(name);
		o.bAttachStatus[slot] = static_cast<INT8>(value);
		++slot;
		if (comma == std::string::npos) break;
		start = comma + 1;
	}
	return o;
}

std::string DescribeDealerObject(OBJECTTYPE const& o)
{
	return Numbers({o.usItem, o.ubNumberOfObjects, o.bStatus[0], o.usGunAmmoItem, o.ubGunShotsLeft, o.bGunAmmoStatus, o.ubImprintID,
		o.usAttachItem[0], o.bAttachStatus[0], o.usAttachItem[1], o.bAttachStatus[1], o.usAttachItem[2], o.bAttachStatus[2],
		o.usAttachItem[3], o.bAttachStatus[3]});
}

ArmsDealerID DealerArgument(Command const& c)
{
	long long const id = Required(c, "dealer");
	if (id < 0 || id >= NUM_ARMS_DEALERS) throw std::runtime_error("dealer must be 0..18");
	return static_cast<ArmsDealerID>(id);
}

void ProbeDealerPrice(Command const& c)
{
	ArmsDealerID const dealer = DealerArgument(c);
	DealerModel const* const model = GCM->getDealer(dealer);
	OBJECTTYPE const o = DealerProbeObject(c);
	UINT8 const merc = static_cast<UINT8>(Integer(c, "merc", NO_PROFILE));
	Json json = Json{}.str("probe", "dealerprice").num("line", c.line).raw("args", DescribeArgs(c)).raw("object", DescribeDealerObject(o));
	json.nums("value", {CalcValueOfItemToDealer(dealer, o.usItem, TRUE), CalcValueOfItemToDealer(dealer, o.usItem, FALSE)});
	json.real("condition", OracleItemConditionModifier(o.usItem, o.bStatus[0]));
	if (model->type != ARMS_DEALER_REPAIRS)
	{
		json.nums("selling", {OracleCalcShopKeeperItemPrice(dealer, merc, TRUE, TRUE, model->sellingPrice, &o),
			OracleCalcShopKeeperItemPrice(dealer, merc, TRUE, FALSE, model->sellingPrice, &o)});
		json.nums("buying", {OracleCalcShopKeeperItemPrice(dealer, merc, FALSE, TRUE, model->buyingPrice, &o),
			OracleCalcShopKeeperItemPrice(dealer, merc, FALSE, FALSE, model->buyingPrice, &o)});
		UINT32 price = 0;
		UINT32 const eval = OracleEvaluateInvSlot(dealer, merc, &o, &price);
		json.nums("eval", {eval, price});
	}
	json.nums("transact", {CanDealerTransactItem(dealer, o.usItem, FALSE), CanDealerTransactItem(dealer, o.usItem, TRUE)});
	Emit(json);
}

void ProbeDealerSell(Command const& c)
{
	ArmsDealerID const dealer = DealerArgument(c);
	OBJECTTYPE o = DealerProbeObject(c);
	std::string const object = DescribeDealerObject(o);
	AddObjectToArmsDealerInventory(dealer, &o);
	Emit(DealerContext("dealersell", c).raw("args", DescribeArgs(c)).raw("object", object).raw("dealers", DescribeDealers()));
}

void SetShopHours(Command const& c)
{
	gOracleShopHoursActive = Has(c, "open");
	gOracleShopOpeningTime = static_cast<UINT32>(Integer(c, "open", 0));
	gOracleShopClosingTime = static_cast<UINT32>(Integer(c, "close", 0));
	Emit(Json{}.str("probe", "shophours").num("line", c.line).flag("active", gOracleShopHoursActive)
		.num("open", gOracleShopOpeningTime).num("close", gOracleShopClosingTime));
}

void ProbeDealerRepair(Command const& c)
{
	ArmsDealerID const dealer = DealerArgument(c);
	if (GCM->getDealer(dealer)->type != ARMS_DEALER_REPAIRS) throw std::runtime_error("dealerrepair needs a repairman");
	OBJECTTYPE const o = DealerProbeObject(c);
	UINT32 const start = static_cast<UINT32>(Integer(c, "start", GetWorldTotalMin()));
	UINT32 const cost = CalculateObjectItemRepairCost(dealer, &o);
	UINT32 const time = CalculateObjectItemRepairTime(dealer, &o);
	std::vector<long long> closed;
	std::string const ks = Text(c, "ks", "");
	size_t at = 0;
	while (at < ks.size())
	{
		size_t const comma = ks.find(',', at);
		UINT32 const k = static_cast<UINT32>(std::stoul(ks.substr(at, comma == std::string::npos ? std::string::npos : comma - at)));
		closed.push_back(CalculateMinutesClosedBetween(dealer, start, start + k));
		if (comma == std::string::npos) break;
		at = comma + 1;
	}
	Emit(Json{}.str("probe", "dealerrepair").num("line", c.line).raw("args", DescribeArgs(c)).raw("object", DescribeDealerObject(o))
		.num("start", start).num("cost", cost).num("time", time).num("overnight", CalculateOvernightRepairDelay(dealer, start, time))
		.flag("repairable", CanDealerRepairItem(dealer, o.usItem)).nums("closed", closed));
}

void SkipTime(Command const& c)
{
	UINT32 const seconds = static_cast<UINT32>(Required(c, "seconds"));
	WarpGameTime(seconds, WARPTIME_NO_PROCESSING_OF_EVENTS);
	Emit(Json{}.str("probe", "skiptime").num("line", c.line).num("seconds", seconds).num("worldSeconds", GetWorldTotalSeconds()));
}

void GiveDealerRepair(Command const& c)
{
	ArmsDealerID const dealer = DealerArgument(c);
	OBJECTTYPE const o = DealerProbeObject(c);
	UINT8 const owner = static_cast<UINT8>(Integer(c, "owner", NO_PROFILE));
	GiveObjectToArmsDealerForRepair(dealer, &o, owner);
	UINT8 const element = gubLastSpecialItemAddedAtElement;
	UINT32 const done = gArmsDealersInventory[dealer][o.usItem].SpecialItem[element].uiRepairDoneTime;
	Emit(Json{}.str("probe", "dealergive").num("line", c.line).raw("args", DescribeArgs(c)).raw("object", DescribeDealerObject(o))
		.num("worldMinutes", GetWorldTotalMin()).num("element", element).num("done", done));
}

std::string DescribeSkiBoxes(std::vector<OracleSkiBox> const& boxes)
{
	std::vector<std::string> out;
	for (OracleSkiBox const& b : boxes)
	{
		out.push_back(Json{}.num("item", b.item).num("element", b.element).num("count", b.count).num("flags", b.flags)
			.num("unitPrice", b.unitPrice).num("owner", b.owner).raw("object", DescribeDealerObject(b.object)).text());
	}
	return JsonArray(out);
}

void ProbeShopKeeper(Command const& c)
{
	ArmsDealerID const dealer = DealerArgument(c);
	UINT8 const merc = static_cast<UINT8>(Integer(c, "merc", NO_PROFILE));
	std::vector<OracleSkiBox> boxes;
	std::vector<OracleSkiBox> offered;
	BOOLEAN delayed = FALSE;
	Json json = DealerContext("ski", c);
	std::string const draws = TracedSaiDraws([&] {
		if (DoesDealerDoRepairs(dealer)) delayed = OracleHandlePossibleRepairDelays(dealer);
		OracleInitializeShopKeeper(dealer, merc, &boxes, &offered);
	});
	Emit(json.num("dealer", dealer).num("merc", merc).flag("delayed", delayed).raw("boxes", DescribeSkiBoxes(boxes))
		.raw("offered", DescribeSkiBoxes(offered)).raw("draws", draws).raw("dealers", DescribeDealers()));
}

constexpr int NUM_LEAVE_SLOTS = 20;
constexpr int PERSONNEL_SHOWN = 16;
constexpr int PROFILE_RELATION_SLOTS = 5;
constexpr int SUBPOINTS_PER_LEVEL = 350;
constexpr UINT8 CONTRACT_EVENTS[] = {
	EVENT_MERC_COMPLAIN_EQUIPMENT, EVENT_MERC_LEAVE_EQUIP_IN_OMERTA, EVENT_MERC_LEAVE_EQUIP_IN_DRASSEN, EVENT_MERC_ABOUT_TO_LEAVE,
	EVENT_BEGIN_CONTRACT_RENEWAL_SEQUENCE, EVENT_RPC_WHINE_ABOUT_PAY, EVENT_MERC_MERC_WENT_UP_LEVEL_EMAIL_DELAY
};

std::string DescribeContractMerc(SOLDIERTYPE& s)
{
	bool const profiled = s.ubProfile != NO_PROFILE;
	MERCPROFILESTRUCT const* const p = profiled ? &GetProfile(s.ubProfile) : nullptr;
	return Json{}
		.num("id", s.ubID)
		.num("profile", s.ubProfile)
		.num("kind", s.ubWhatKindOfMercAmI)
		.num("assignment", s.bAssignment)
		.num("life", s.bLife)
		.num("lifeMax", s.bLifeMax)
		.num("morale", s.bMorale)
		.raw("sector", StrategicSector(s.sSector))
		.flag("betweenSectors", s.fBetweenSectors)
		.num("end", s.iEndofContractTime)
		.num("start", s.iStartContractTime)
		.num("total", s.iTotalContractLength)
		.num("type", s.bTypeOfLastContract)
		.num("canSign", s.iTimeCanSignElsewhere)
		.flag("signed", s.fSignedAnotherContract)
		.num("lastUpdate", s.uiTimeOfLastContractUpdate)
		.num("arrive", s.uiTimeSoldierWillArrive)
		.num("quoteCode", s.ubContractRenewalQuoteCode)
		.num("leaveCode", s.ubLeaveHistoryCode)
		.num("deposit", s.usMedicalDeposit)
		.flag("priceUp", s.fContractPriceHasIncreased)
		.raw("insurance", Numbers({s.usLifeInsurance, s.iStartOfInsuranceContract, s.iTotalLengthOfInsuranceContract, s.uiStartTimeOfInsuranceContract}))
		.num("quoteFlags", s.usQuoteSaidFlags)
		.num("corpseTolerance", s.bCorpseQuoteTolerance)
		.num("hour", GetHourWhenContractDone(&s))
		.flag("expiring", OracleContractIsExpiring(&s))
		.flag("soon", OracleContractIsGoingToExpireSoon(&s))
		.num("refusal", profiled ? OracleFindRefusalReason(&s) : QUOTE_NONE)
		.flag("willRenew", profiled && WillMercRenew(&s, FALSE))
		.num("buddy", p ? GetFirstBuddyOnTeam(*p) : BUDDY_NOT_FOUND)
		.flag("deathRateTooHigh", p && MercThinksDeathRateTooHigh(*p))
		.flag("reputationTooHigh", p && MercThinksBadReputationTooHigh(*p))
		.flag("moraleTooLow", profiled && MercThinksHisMoraleIsTooLow(&s))
		.flag("worseEquipment", profiled && SoldierHasWorseEquipmentThanUsedTo(&s))
		.flag("canExtend", CanExtendContractForSoldier(&s))
		.text();
}

std::string DescribeLeaveList()
{
	std::vector<std::string> slots;
	for (UINT32 i = 0; i < NUM_LEAVE_SLOTS; ++i)
	{
		std::vector<OBJECTTYPE> objects;
		INT32 const n = OracleLeaveListItems(i, &objects);
		std::vector<long long> items;
		for (OBJECTTYPE const& o : objects) items.push_back(o.usItem);
		slots.push_back(Json{}.num("owner", OracleLeaveListOwner(i)).raw("items", n < 0 ? "null" : Numbers(items)).text());
	}
	return JsonArray(slots);
}

std::string DescribeContractEvents()
{
	std::vector<std::string> events;
	for (STRATEGICEVENT const* e = gpEventList; e; e = e->next)
	{
		if (std::find(std::begin(CONTRACT_EVENTS), std::end(CONTRACT_EVENTS), e->ubCallbackID) == std::end(CONTRACT_EVENTS)) continue;
		events.push_back(Numbers({e->uiTimeStamp, e->ubCallbackID, e->uiParam}));
	}
	return JsonArray(events);
}

std::string DescribeContracts()
{
	std::vector<std::string> mercs;
	FOR_EACH_IN_TEAM(s, OUR_TEAM) mercs.push_back(DescribeContractMerc(*s));
	std::vector<long long> list;
	for (UINT8 i = 0; i < OracleContractRenewalCount(); ++i) list.push_back(OracleContractRenewalProfile(i));
	return Json{}
		.raw("mercs", JsonArray(mercs))
		.raw("renewal", Json{}
			.raw("list", Numbers(list))
			.flag("on", gfContractRenewalSquenceOn)
			.num("current", OracleCurrentContractRenewal())
			.flag("inProgress", OracleContractRenewalInProgress() != 0)
			.flag("fromSequence", gfInContractMenuFromRenewSequence)
			.text())
		.num("deathRate", CalcDeathRate())
		.num("deaths", gStrategicStatus.ubMercDeaths)
		.num("manDays", gStrategicStatus.uiManDaysPlayed)
		.num("reputation", gStrategicStatus.ubBadReputation)
		.num("unhiredDeaths", gStrategicStatus.ubUnhiredMercDeaths)
		.num("account", LaptopSaveInfo.gubPlayersMercAccountStatus)
		.num("balance", LaptopSaveInfo.iCurrentBalance)
		.raw("leave", DescribeLeaveList())
		.raw("events", DescribeContractEvents())
		.num("worldMinutes", GetWorldTotalMin())
		.text();
}

std::string DescribeProfile(ProfileID const pid)
{
	MERCPROFILESTRUCT const& p = GetProfile(pid);
	std::vector<long long> hated, hatedTime, hatedCount, buddies, inventory;
	for (int k = 0; k < PROFILE_RELATION_SLOTS; ++k)
	{
		hated.push_back(p.bHated[k]);
		hatedTime.push_back(p.bHatedTime[k]);
		hatedCount.push_back(p.bHatedCount[k]);
		buddies.push_back(p.bBuddy[k]);
	}
	for (UINT16 const item : p.inv) inventory.push_back(item);
	std::vector<long long> opinions;
	CFOR_EACH_IN_TEAM(o, OUR_TEAM)
	{
		if (o->ubProfile == NO_PROFILE || o->ubProfile >= NUM_PROFILES) continue;
		opinions.push_back(o->ubProfile < lengthof(p.bMercOpinion) ? p.bMercOpinion[o->ubProfile] : 0);
	}
	return Json{}
		.num("id", pid)
		.num("status", p.bMercStatus)
		.num("available", p.uiDayBecomesAvailable)
		.raw("salaries", Numbers({p.sSalary, p.uiWeeklySalary, p.uiBiWeeklySalary}))
		.raw("deposit", Numbers({p.bMedicalDeposit, p.sMedicalDepositAmount}))
		.num("hangover", p.ubDaysOfMoraleHangover)
		.num("precedent", p.uiPrecedentQuoteSaid)
		.num("balance", p.iBalance)
		.num("mercDays", p.iMercMercContractLength)
		.num("served", p.usTotalDaysServed)
		.num("flags3", p.ubMiscFlags3)
		.num("suspicious", p.ubSuspiciousDeath)
		.num("cost", p.uiTotalCostToDate)
		.raw("attractiveness", Numbers({p.bMainGunAttractiveness, p.bArmourAttractiveness}))
		.raw("tolerances", Numbers({p.bDeathRate, p.bReputationTolerance}))
		.raw("stats", Numbers({p.bLifeMax, p.bAgility, p.bDexterity, p.bWisdom, p.bMedical, p.bExplosive, p.bMechanical, p.bMarksmanship,
			p.bExpLevel, p.bStrength, p.bLeadership, p.bLife}))
		.raw("gains", Numbers({p.sLifeGain, p.sAgilityGain, p.sDexterityGain, p.sWisdomGain, p.sMedicalGain, p.sExplosivesGain,
			p.sMechanicGain, p.sMarksmanshipGain, p.sExpLevelGain, p.sStrengthGain, p.sLeadershipGain}))
		.raw("hated", Numbers(hated))
		.raw("hatedTime", Numbers(hatedTime))
		.raw("hatedCount", Numbers(hatedCount))
		.raw("buddies", Numbers(buddies))
		.raw("learn", Numbers({p.bLearnToHate, p.bLearnToHateTime, p.bLearnToHateCount, p.bLearnToLike, p.bLearnToLikeTime,
			p.bLearnToLikeCount, p.ubTimeTillNextHatedComplaint}))
		.raw("opinions", Numbers(opinions))
		.raw("inventory", Numbers(inventory))
		.text();
}

std::vector<ProfileID> ProfileSelection(Command const& c)
{
	std::vector<ProfileID> ids;
	if (Has(c, "who") && c.name == "profiles")
	{
		for (std::string const& part : SplitList(Text(c, "who", ""), ',')) ids.push_back(static_cast<ProfileID>(ParseInteger("who", part)));
	}
	else if (Has(c, "range"))
	{
		std::vector<std::string> const bounds = SplitList(Text(c, "range", ""), ':');
		if (bounds.size() != 2) throw std::runtime_error("range needs <from>:<to>");
		for (long long id = ParseInteger("range", bounds[0]); id < ParseInteger("range", bounds[1]); ++id) ids.push_back(static_cast<ProfileID>(id));
	}
	else
	{
		CFOR_EACH_IN_TEAM(s, OUR_TEAM)
		{
			if (s->ubProfile != NO_PROFILE) ids.push_back(s->ubProfile);
		}
	}
	return ids;
}

std::string DescribeProfiles(std::vector<ProfileID> const& ids)
{
	std::vector<std::string> profiles;
	for (ProfileID const id : ids) profiles.push_back(DescribeProfile(id));
	return JsonArray(profiles);
}

void EmitContracts(Command const& c, std::vector<ProfileID> const& profiles, std::string const& draws, std::string const& extra)
{
	Json json;
	json.str("probe", c.name).num("line", c.line).raw("args", DescribeArgs(c));
	if (!draws.empty()) json.raw("draws", draws);
	if (!extra.empty()) json.raw("result", extra);
	json.raw("contracts", DescribeContracts());
	json.raw("profiles", DescribeProfiles(profiles));
	Emit(json);
}

void EmitContracts(Command const& c, std::string const& draws, std::string const& extra)
{
	EmitContracts(c, ProfileSelection(c), draws, extra);
}

void DumpContracts(Command const& c)
{
	EmitContracts(c, "", "");
}

void ProbeDailyUpdate(Command const& c)
{
	std::string const draws = TracedSaiDraws([] { MercDailyUpdate(); });
	EmitContracts(c, draws, "");
}

void ProbeRelationsHours(Command const& c)
{
	long long const count = Integer(c, "count", 1);
	for (long long i = 0; i < count; ++i)
	{
		UpdateBuddyAndHatedCounters();
		HourlyMoraleUpdate();
	}
	EmitContracts(c, "", "");
}

void SetContractTime(Command const& c)
{
	UINT32 const now = GetWorldTotalMin();
	UINT32 const target = static_cast<UINT32>(Integer(c, "hour", 0) * 60 + Integer(c, "minute", 0));
	UINT32 const today = GetWorldDayInMinutes();
	UINT32 const at = Has(c, "day") ? static_cast<UINT32>(Integer(c, "day", 0) * NUM_MIN_IN_DAY) + target :
		(today + target > now ? today + target : today + NUM_MIN_IN_DAY + target);
	if (at < now) throw std::runtime_error("settime cannot go back in time");
	WarpGameTime((at - now) * NUM_SEC_IN_MIN, WARPTIME_NO_PROCESSING_OF_EVENTS);
	EmitContracts(c, "", Numbers({now, at}));
}

void ProbeAboutToLeave(Command const& c)
{
	std::string const draws = TracedSaiDraws([] { FindOutIfAnyMercAboutToLeaveIsGonnaRenew(); });
	EmitContracts(c, draws, "");
}

void ProbeBeginRenewal(Command const& c)
{
	std::string const draws = TracedSaiDraws([] { BeginContractRenewalSequence(); });
	EmitContracts(c, draws, "");
}

void ProbeRenewalStep(Command const& c)
{
	std::string const draws = TracedSaiDraws([] { HandleContractRenewalSequence(); });
	EmitContracts(c, draws, "");
}

void SetContract(Command const& c)
{
	SOLDIERTYPE& s = GetMan(static_cast<SoldierID>(Required(c, "who")));
	s.iEndofContractTime = static_cast<INT32>(Integer(c, "end", s.iEndofContractTime));
	s.iTotalContractLength = static_cast<INT32>(Integer(c, "total", s.iTotalContractLength));
	s.uiTimeSoldierWillArrive = static_cast<UINT32>(Integer(c, "arrive", s.uiTimeSoldierWillArrive));
	s.uiTimeOfLastContractUpdate = static_cast<UINT32>(Integer(c, "lastUpdate", s.uiTimeOfLastContractUpdate));
	s.iTimeCanSignElsewhere = static_cast<INT32>(Integer(c, "canSign", s.iTimeCanSignElsewhere));
	s.fSignedAnotherContract = Integer(c, "signed", s.fSignedAnotherContract) != 0;
	s.ubContractRenewalQuoteCode = static_cast<UINT8>(Integer(c, "quoteCode", s.ubContractRenewalQuoteCode));
	s.bTypeOfLastContract = static_cast<INT8>(Integer(c, "type", s.bTypeOfLastContract));
	s.fContractPriceHasIncreased = Integer(c, "priceUp", s.fContractPriceHasIncreased) != 0;
	s.bLife = static_cast<INT8>(Integer(c, "life", s.bLife));
	s.bBleeding = static_cast<INT8>(Integer(c, "bleeding", s.bBleeding));
	s.bMorale = static_cast<INT8>(Integer(c, "morale", s.bMorale));
	s.ubWhatKindOfMercAmI = static_cast<UINT8>(Integer(c, "kind", s.ubWhatKindOfMercAmI));
	s.usMedicalDeposit = static_cast<UINT16>(Integer(c, "deposit", s.usMedicalDeposit));
	s.bAssignment = static_cast<INT8>(Integer(c, "assignment", s.bAssignment));
	s.usLifeInsurance = static_cast<UINT16>(Integer(c, "insurance", s.usLifeInsurance));
	EmitContracts(c, "", "");
}

void SetContractStatus(Command const& c)
{
	gStrategicStatus.ubMercDeaths = static_cast<UINT8>(Integer(c, "deaths", gStrategicStatus.ubMercDeaths));
	gStrategicStatus.uiManDaysPlayed = static_cast<UINT32>(Integer(c, "manDays", gStrategicStatus.uiManDaysPlayed));
	gStrategicStatus.ubBadReputation = static_cast<UINT8>(Integer(c, "reputation", gStrategicStatus.ubBadReputation));
	LaptopSaveInfo.gubPlayersMercAccountStatus = static_cast<UINT8>(Integer(c, "account", LaptopSaveInfo.gubPlayersMercAccountStatus));
	if (Has(c, "balance"))
	{
		INT32 const delta = static_cast<INT32>(Integer(c, "balance", 0)) - LaptopSaveInfo.iCurrentBalance;
		AddTransactionToPlayersBook(ANONYMOUS_DEPOSIT, 0, GetWorldTotalMin(), delta);
	}
	EmitContracts(c, "", "");
}

void SetProfileContract(Command const& c)
{
	ProfileID const pid = static_cast<ProfileID>(Required(c, "who"));
	MERCPROFILESTRUCT& p = GetProfile(pid);
	p.bMercStatus = static_cast<INT8>(Integer(c, "status", p.bMercStatus));
	p.uiDayBecomesAvailable = static_cast<UINT32>(Integer(c, "available", p.uiDayBecomesAvailable));
	p.ubDaysOfMoraleHangover = static_cast<UINT8>(Integer(c, "hangover", p.ubDaysOfMoraleHangover));
	p.iBalance = static_cast<INT32>(Integer(c, "balance", p.iBalance));
	p.iMercMercContractLength = static_cast<INT32>(Integer(c, "mercDays", p.iMercMercContractLength));
	p.bDeathRate = static_cast<INT8>(Integer(c, "deathRate", p.bDeathRate));
	p.bReputationTolerance = static_cast<INT8>(Integer(c, "repTolerance", p.bReputationTolerance));
	p.ubMiscFlags3 = static_cast<UINT8>(Integer(c, "flags3", p.ubMiscFlags3));
	p.sSalary = static_cast<INT16>(Integer(c, "salary", p.sSalary));
	p.bMainGunAttractiveness = static_cast<INT8>(Integer(c, "gunAttractiveness", p.bMainGunAttractiveness));
	if (Has(c, "buddy"))
	{
		std::vector<long long> const v = TripleArgument(c, "buddy");
		if (v.size() != 2) throw std::runtime_error("buddy needs slot:profile");
		p.bBuddy[v[0]] = static_cast<INT8>(v[1]);
	}
	if (Has(c, "hated"))
	{
		std::vector<long long> const v = TripleArgument(c, "hated");
		if (v.size() != 4) throw std::runtime_error("hated needs slot:profile:time:count");
		p.bHated[v[0]] = static_cast<INT8>(v[1]);
		p.bHatedTime[v[0]] = static_cast<INT8>(v[2]);
		p.bHatedCount[v[0]] = static_cast<INT8>(v[3]);
	}
	if (Has(c, "learnhate"))
	{
		std::vector<long long> const v = TripleArgument(c, "learnhate");
		if (v.size() != 3) throw std::runtime_error("learnhate needs profile:time:count");
		p.bLearnToHate = static_cast<INT8>(v[0]);
		p.bLearnToHateTime = static_cast<INT8>(v[1]);
		p.bLearnToHateCount = static_cast<INT8>(v[2]);
	}
	if (Has(c, "opinion"))
	{
		std::vector<long long> const v = TripleArgument(c, "opinion");
		if (v.size() != 2) throw std::runtime_error("opinion needs about:value");
		p.bMercOpinion[v[0]] = static_cast<INT8>(v[1]);
	}
	EmitContracts(c, {pid}, "", "");
}

UINT8 ExtensionArgument(Command const& c)
{
	std::string const length = Text(c, "length", "week");
	if (length == "day") return CONTRACT_EXTEND_1_DAY;
	if (length == "week") return CONTRACT_EXTEND_1_WEEK;
	if (length == "twoWeeks") return CONTRACT_EXTEND_2_WEEK;
	throw std::runtime_error("length must be day, week or twoWeeks");
}

void ProbeExtendContract(Command const& c)
{
	SOLDIERTYPE& s = GetMan(static_cast<SoldierID>(Required(c, "who")));
	UINT8 const length = ExtensionArgument(c);
	BOOLEAN extended = FALSE;
	std::string const draws = TracedSaiDraws([&] { extended = MercContractHandling(&s, length); });
	EmitContracts(c, draws, extended ? "true" : "false");
}

void ProbeBeginRemove(Command const& c)
{
	SOLDIERTYPE& s = GetMan(static_cast<SoldierID>(Required(c, "who")));
	if (Integer(c, "fired", 0)) s.ubLeaveHistoryCode = HISTORY_MERC_FIRED;
	std::string const draws = TracedSaiDraws([&] { OracleBeginRemoveMercFromContract(&s); });
	EmitContracts(c, draws, "");
}

std::string DescribePersonnel(INT16 const* list)
{
	std::vector<long long> ids;
	for (int i = 0; i < PERSONNEL_SHOWN && list[i] != -1; ++i) ids.push_back(list[i]);
	return Numbers(ids);
}

void ProbeRemoveMerc(Command const& c)
{
	SOLDIERTYPE& s = GetMan(static_cast<SoldierID>(Required(c, "who")));
	ProfileID const pid = s.ubProfile;
	if (Has(c, "history")) s.ubLeaveHistoryCode = static_cast<UINT8>(Integer(c, "history", 0));
	std::string const draws = TracedSaiDraws([&] { StrategicRemoveMerc(s); });
	std::string const personnel = Json{}
		.raw("dead", DescribePersonnel(LaptopSaveInfo.ubDeadCharactersList))
		.raw("fired", DescribePersonnel(LaptopSaveInfo.ubLeftCharactersList))
		.raw("other", DescribePersonnel(LaptopSaveInfo.ubOtherCharactersList))
		.text();
	std::vector<ProfileID> profiles = ProfileSelection(c);
	profiles.push_back(pid);
	EmitContracts(c, profiles, draws, personnel);
}

void ProbeLeaveEquipment(Command const& c)
{
	SOLDIERTYPE& s = GetMan(static_cast<SoldierID>(Required(c, "who")));
	std::string const where = Text(c, "where", "here");
	std::string const draws = TracedSaiDraws([&] {
		if (where == "here") HandleLeavingOfEquipmentInCurrentSector(s);
		else HandleMercLeavingEquipment(s, where == "drassen");
	});
	EmitContracts(c, draws, "");
}

void ProbeEquipmentDelivered(Command const& c)
{
	UINT32 const slot = static_cast<UINT32>(Required(c, "slot"));
	std::string const draws = TracedSaiDraws([&] {
		if (Text(c, "where", "omerta") == "drassen") HandleEquipmentLeftInDrassen(slot);
		else HandleEquipmentLeftInOmerta(slot);
	});
	EmitContracts(c, draws, "");
}

void ProbeMercSite(Command const& c)
{
	std::string const draws = TracedSaiDraws([] { DailyUpdateOfMercSite(); });
	EmitContracts(c, draws, "");
}

void ProbeLevelUp(Command const& c)
{
	SOLDIERTYPE& s = GetMan(static_cast<SoldierID>(Required(c, "who")));
	MERCPROFILESTRUCT& p = GetProfile(s.ubProfile);
	p.sExpLevelGain = static_cast<INT16>(SUBPOINTS_PER_LEVEL * p.bExpLevel);
	std::string const draws = TracedSaiDraws([] { HandleAnyStatChangesAfterAttack(); });
	EmitContracts(c, draws, "");
}

void ProbeSalary(Command const& c)
{
	std::vector<long long> salaries;
	UINT32 const max = static_cast<UINT32>(Integer(c, "max", 30000));
	for (std::string const& part : SplitList(Text(c, "values", ""), ','))
		salaries.push_back(OracleCalcNewSalary(static_cast<UINT32>(ParseInteger("values", part)), max));
	Emit(Json{}.str("probe", c.name).num("line", c.line).raw("args", DescribeArgs(c)).raw("salaries", Numbers(salaries)));
}

void SetRenewals(Command const& c)
{
	std::vector<UINT8> profiles;
	for (std::string const& part : SplitList(Text(c, "profiles", ""), ',')) profiles.push_back(static_cast<UINT8>(ParseInteger("profiles", part)));
	OracleSetContractRenewals(profiles);
	EmitContracts(c, "", "");
}

std::map<std::string, INT8> const CREATURE_BODIES{
	{"af", ADULTFEMALEMONSTER}, {"am", AM_MONSTER}, {"yf", YAF_MONSTER}, {"ym", YAM_MONSTER}, {"larva", LARVAE_MONSTER},
	{"infant", INFANT_MONSTER}, {"queen", QUEENMONSTER}, {"bloodcat", BLOODCAT}, {"regmale", REGMALE}, {"bigmale", BIGMALE},
	{"stockymale", STOCKYMALE}, {"regfemale", REGFEMALE},
};

std::string DescribeInventoryFlags(SOLDIERTYPE const& s)
{
	std::vector<long long> flags;
	for (int slot = 0; slot < NUM_INV_SLOTS; ++slot) flags.push_back(s.inv[slot].fFlags);
	std::string list = "[";
	for (size_t i = 0; i < flags.size(); ++i)
	{
		if (i) list += ",";
		list += std::to_string(flags[i]);
	}
	return list + "]";
}

std::string DescribeCreatureAI(SOLDIERTYPE const& s)
{
	std::vector<long long> const patrol(std::begin(s.usPatrolGrid), std::end(s.usPatrolGrid));
	return Json{}
		.num("side", static_cast<long long>(s.bSide))
		.num("neutral", s.bNeutral)
		.num("normalSmell", s.bNormalSmell)
		.num("monsterSmell", s.bMonsterSmell)
		.num("mobility", s.bMobility)
		.num("caller", s.ubCaller)
		.num("callerGridNo", s.sCallerGridNo)
		.num("callPriority", s.bCallPriority)
		.num("callActedUpon", s.bCallActedUpon)
		.num("frenzied", s.bFrenzied)
		.num("hunting", s.bHunting)
		.num("oldLife", s.bOldLife)
		.num("regeneration", s.bRegenerationCounter)
		.num("action", s.bAction)
		.num("actionData", s.usActionData)
		.num("nextAction", s.bNextAction)
		.num("nextActionData", s.usNextActionData)
		.num("lastAction", s.bLastAction)
		.num("actionInProgress", s.bActionInProgress)
		.num("newSituation", s.bNewSituation)
		.num("bypassToGreen", s.bBypassToGreen)
		.num("dominantDir", s.bDominantDir)
		.num("noiseGridNo", s.sNoiseGridno)
		.num("noiseVolume", s.ubNoiseVolume)
		.num("noiseLevel", s.bNoiseLevel)
		.num("oppCount", s.bOppCnt)
		.num("underFire", s.bUnderFire)
		.num("uiMovementMode", s.usUIMovementMode)
		.nums("patrolGrid", patrol)
		.num("patrolCount", s.bPatrolCnt)
		.num("nextPatrolPoint", s.bNextPatrolPnt)
		.num("finalDestination", s.sFinalDestination)
		.num("aimTime", s.bAimTime)
		.num("aimShotLocation", s.bAimShotLocation)
		.num("targetLevel", s.bTargetLevel)
		.num("walkToAttackGridNo", s.sWalkToAttackGridNo)
		.num("walkToAttackCost", s.sWalkToAttackWalkToCost)
		.num("blackList", s.sBlackList)
		.num("stealth", s.bStealthMode)
		.flag("teamAware", gTacticalStatus.Team[s.bTeam].bAwareOfOpposition)
		.num("hand", s.inv[HANDPOS].usItem)
		.num("secondHand", s.inv[SECONDHANDPOS].usItem)
		.raw("inventoryFlags", DescribeInventoryFlags(s))
		.text();
}

void EmitCreatureSoldier(char const* probe, Command const& c, SOLDIERTYPE const& s)
{
	Emit(Json{}
		.str("probe", probe)
		.num("line", c.line)
		.num("who", s.ubID)
		.raw("soldier", DescribeDetail(s))
		.raw("ai", DescribeCreatureAI(s)));
}

void ApplyNoise(SOLDIERTYPE& s, std::string const& spec)
{
	std::vector<std::string> const parts = SplitList(spec, ':');
	if (parts.size() < 2) throw std::runtime_error("noise looks like <grid>:<volume>[:<level>]");
	s.sNoiseGridno  = static_cast<INT16>(ParseInteger("noise", parts[0]));
	s.ubNoiseVolume = static_cast<UINT8>(ParseInteger("noise", parts[1]));
	s.bNoiseLevel   = parts.size() > 2 ? static_cast<INT8>(ParseInteger("noise", parts[2])) : 0;
}

void ApplyCaller(SOLDIERTYPE& s, std::string const& spec)
{
	std::vector<std::string> const parts = SplitList(spec, ':');
	if (parts.size() != 3) throw std::runtime_error("caller looks like <id>:<grid>:<priority>");
	s.ubCaller      = static_cast<UINT8>(ParseInteger("caller", parts[0]));
	s.sCallerGridNo = static_cast<INT16>(ParseInteger("caller", parts[1]));
	s.bCallPriority = static_cast<UINT8>(ParseInteger("caller", parts[2]));
}

template<typename T>
void SetIfGiven(Command const& c, char const* key, T& field)
{
	if (Has(c, key)) field = static_cast<T>(Integer(c, key, 0));
}

void ApplySoldierSettings(Command const& c, SOLDIERTYPE& s)
{
	SetIfGiven(c, "alert", s.bAlertStatus);
	SetIfGiven(c, "orders", s.bOrders);
	SetIfGiven(c, "attitude", s.bAttitude);
	SetIfGiven(c, "ap", s.bActionPoints);
	SetIfGiven(c, "initialAp", s.bInitialActionPoints);
	SetIfGiven(c, "life", s.bLife);
	SetIfGiven(c, "oldLife", s.bOldLife);
	SetIfGiven(c, "breath", s.bBreath);
	SetIfGiven(c, "hunting", s.bHunting);
	SetIfGiven(c, "frenzied", s.bFrenzied);
	SetIfGiven(c, "underFire", s.bUnderFire);
	SetIfGiven(c, "opps", s.bOppCnt);
	SetIfGiven(c, "lastAction", s.bLastAction);
	SetIfGiven(c, "actionData", s.usActionData);
	SetIfGiven(c, "monsterSmell", s.bMonsterSmell);
	SetIfGiven(c, "lastTarget", s.sLastTarget);
	if (Has(c, "noise")) ApplyNoise(s, Text(c, "noise", ""));
	if (Has(c, "caller")) ApplyCaller(s, Text(c, "caller", ""));
	if (Has(c, "aware")) gTacticalStatus.Team[s.bTeam].bAwareOfOpposition = Integer(c, "aware", 0) != 0;
	if (Has(c, "face"))
	{
		INT8 const dir = static_cast<INT8>(Integer(c, "face", 0));
		EVENT_SetSoldierDirection(&s, dir);
		EVENT_SetSoldierDesiredDirection(&s, dir);
	}
}

void AddProbeSoldier(Command const& c)
{
	if (!gfWorldLoaded) throw std::runtime_error("no world loaded");
	GridNo const at = GridArgument(c, "at");
	SOLDIERCREATE_STRUCT cs{};
	cs.ubProfile        = NO_PROFILE;
	cs.sSector          = gWorldSector;
	cs.bTeam            = Lookup(TEAMS, c, "team", "creature");
	cs.bBodyType        = Lookup(CREATURE_BODIES, c, "body", "af");
	cs.bDirection       = static_cast<INT8>(Integer(c, "dir", SOUTH));
	cs.sInsertionGridNo = at;
	cs.fOnRoof          = Integer(c, "level", 0) > 0;
	RandomizeNewSoldierStats(&cs);
	SOLDIERTYPE* const s = TacticalCreateSoldier(cs);
	if (!s) throw std::runtime_error("TacticalCreateSoldier failed");
	AddSoldierToSectorNoCalculateDirection(s);
	if (s->sGridNo != at) EVENT_SetSoldierPosition(s, at, SSP_NONE);
	ApplySoldierSettings(c, *s);
	EmitCreatureSoldier("addsoldier", c, *s);
}

void SetProbeSoldier(Command const& c)
{
	SOLDIERTYPE& s = ExistingSoldier(Required(c, "who"));
	ApplySoldierSettings(c, s);
	EmitCreatureSoldier("setsoldier", c, s);
}

void SetSeen(Command const& c)
{
	SOLDIERTYPE& s = ExistingSoldier(Required(c, "who"));
	SOLDIERTYPE const& opp = ExistingSoldier(Required(c, "opp"));
	INT8 const value = static_cast<INT8>(Integer(c, "value", SEEN_CURRENTLY));
	GridNo const grid = static_cast<GridNo>(Integer(c, "grid", opp.sGridNo));
	if (Integer(c, "public", 0) != 0)
	{
		gbPublicOpplist[s.bTeam][opp.ubID]           = value;
		gsPublicLastKnownOppLoc[s.bTeam][opp.ubID]   = grid;
		gbPublicLastKnownOppLevel[s.bTeam][opp.ubID] = opp.bLevel;
	}
	else
	{
		if (value == SEEN_CURRENTLY && s.bOppList[opp.ubID] != SEEN_CURRENTLY) ++s.bOppCnt;
		s.bOppList[opp.ubID]                 = value;
		gsLastKnownOppLoc[s.ubID][opp.ubID]   = grid;
		gbLastKnownOppLevel[s.ubID][opp.ubID] = opp.bLevel;
	}
	Emit(Json{}
		.str("probe", "seen")
		.num("line", c.line)
		.num("who", s.ubID)
		.num("opp", opp.ubID)
		.num("value", value)
		.num("grid", grid)
		.flag("public", Integer(c, "public", 0) != 0)
		.raw("soldier", DescribeDetail(s))
		.raw("ai", DescribeCreatureAI(s)));
}

void ProbeDecision(Command const& c)
{
	SOLDIERTYPE& s = ExistingSoldier(Required(c, "who"));
	bool const status = Integer(c, "status", 1) != 0;
	gfTurnBasedAI = (gTacticalStatus.uiFlags & INCOMBAT) != 0;
	INT8 action = AI_ACTION_NONE;
	std::string const draws = TracedSaiDraws([&] {
		if (status) DecideAlertStatus(&s);
		if (CREATURE_OR_BLOODCAT(&s)) action = CreatureDecideAction(&s);
		else if (s.ubBodyType == CROW) action = CrowDecideAction(&s);
		else action = DecideAction(&s);
	});
	Emit(Json{}
		.str("probe", "decide")
		.num("line", c.line)
		.num("who", s.ubID)
		.flag("status", status)
		.flag("turnBased", gfTurnBasedAI)
		.num("decided", action)
		.raw("soldier", DescribeDetail(s))
		.raw("ai", DescribeCreatureAI(s))
		.raw("draws", draws));
}

void ProbeBestStab(Command const& c)
{
	SOLDIERTYPE& s = ExistingSoldier(Required(c, "who"));
	bool const tentacles = Integer(c, "tentacles", 0) != 0;
	AttackStateGuard const guard;
	ATTACKTYPE best{};
	std::string const draws = TracedSaiDraws([&] {
		if (tentacles) CalcTentacleAttack(&s, &best);
		else CalcBestStab(&s, &best, Integer(c, "blade", 1) != 0);
	});
	Emit(Json{}
		.str("probe", "beststab")
		.num("line", c.line)
		.num("who", s.ubID)
		.flag("tentacles", tentacles)
		.num("weapon", s.inv[HANDPOS].usItem)
		.num("ap", s.bActionPoints)
		.flag("possible", best.ubPossible)
		.raw("opponent", NullableId(best.opponent))
		.num("target", best.sTarget)
		.num("aimTime", best.ubAimTime)
		.num("chanceToReallyHit", best.ubChanceToReallyHit)
		.num("apCost", best.ubAPCost)
		.num("attackValue", best.iAttackValue)
		.num("walkToAttackGridNo", s.sWalkToAttackGridNo)
		.num("walkToAttackCost", s.sWalkToAttackWalkToCost)
		.raw("draws", draws));
}

void ProbeStab(Command const& c)
{
	SOLDIERTYPE& s = ExistingSoldier(Required(c, "who"));
	SOLDIERTYPE& tgt = ExistingSoldier(Required(c, "target"));
	UINT8 const aim = static_cast<UINT8>(Integer(c, "aim", 0));
	INT32 const hitBy = static_cast<INT32>(Integer(c, "hitBy", 0));
	AttackStateGuard const guard;
	s.usAttackingWeapon = s.inv[HANDPOS].usItem;
	UINT32 const chance = CalcChanceToStab(&s, &tgt, aim);
	INT32 impact = 0;
	std::string const draws = TracedSaiDraws([&] { impact = HTHImpact(&s, &tgt, hitBy, TRUE); });
	Emit(Json{}
		.str("probe", "stab")
		.num("line", c.line)
		.num("who", s.ubID)
		.num("target", tgt.ubID)
		.num("weapon", s.usAttackingWeapon)
		.num("aim", aim)
		.num("chance", chance)
		.num("hitBy", hitBy)
		.num("impact", impact)
		.raw("draws", draws));
}

void ProbeCreatureCall(Command const& c)
{
	SOLDIERTYPE& s = ExistingSoldier(Required(c, "who"));
	s.usActionData = static_cast<UINT16>(Integer(c, "call", CALL_1_PREY));
	std::string const draws = TracedSaiDraws([&] { CreatureCall(&s); });
	std::vector<std::string> receivers;
	FOR_EACH_IN_TEAM(r, s.bTeam)
	{
		if (!r->bInSector) continue;
		receivers.push_back(Json{}.num("id", r->ubID).num("alert", r->bAlertStatus).raw("ai", DescribeCreatureAI(*r)).text());
	}
	Emit(Json{}
		.str("probe", "creaturecall")
		.num("line", c.line)
		.num("who", s.ubID)
		.num("call", s.usActionData)
		.flag("aware", gTacticalStatus.Team[s.bTeam].bAwareOfOpposition)
		.raw("receivers", JsonArray(receivers))
		.raw("draws", draws));
}

void SetSmell(Command const& c)
{
	GridNo const g = GridArgument(c, "g");
	if (Has(c, "smell")) gpWorldLevelData[g].ubSmellInfo = static_cast<UINT8>(Integer(c, "smell", 0));
	if (Has(c, "blood")) gpWorldLevelData[g].ubBloodInfo = static_cast<UINT8>(Integer(c, "blood", 0));
	Emit(Json{}
		.str("probe", "smell")
		.num("line", c.line)
		.num("g", g)
		.num("smell", gpWorldLevelData[g].ubSmellInfo)
		.num("blood", gpWorldLevelData[g].ubBloodInfo));
}

void ProbeDropSmell(Command const& c)
{
	SOLDIERTYPE& s = ExistingSoldier(Required(c, "who"));
	DropSmell(s);
	Emit(Json{}
		.str("probe", "dropsmell")
		.num("line", c.line)
		.num("who", s.ubID)
		.num("g", s.sGridNo)
		.num("smell", gpWorldLevelData[s.sGridNo].ubSmellInfo)
		.num("blood", gpWorldLevelData[s.sGridNo].ubBloodInfo));
}

void ProbeTrackScent(Command const& c)
{
	SOLDIERTYPE& s = ExistingSoldier(Required(c, "who"));
	if (Has(c, "actionData")) s.usActionData = static_cast<UINT16>(Integer(c, "actionData", 0));
	INT16 result = 0;
	std::string const draws = TracedSaiDraws([&] { result = TrackScent(&s); });
	Emit(Json{}
		.str("probe", "trackscent")
		.num("line", c.line)
		.num("who", s.ubID)
		.num("result", result)
		.num("actionData", s.usActionData)
		.raw("draws", draws));
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
	if (c.name == "lights")   return DumpLights(c);
	if (c.name == "ambient")  return SetAmbientLight(c);
	if (c.name == "stratcosts") return ProbeStrategicCosts(c);
	if (c.name == "stratpath") return ProbeStrategicPath(c);
	if (c.name == "groups") return DumpStrategicGroups(c);
	if (c.name == "seed") return SeedRandomEngine(c);
	if (c.name == "arsetup") return SetupAutoResolve(c);
	if (c.name == "enemycounts") return ProbeEnemyCounts(c);
	if (c.name == "pbi") return ProbePreBattle(c);
	if (c.name == "autoresolve") return RunAutoResolve(c);
	if (c.name == "strategic") return DumpStrategicEconomy(c);
	if (c.name == "mercs") return DumpStrategicMercs(c);
	if (c.name == "loyalty") return ProbeLoyaltyEvent(c);
	if (c.name == "warp") return WarpTime(c);
	if (c.name == "assign") return AssignMerc(c);
	if (c.name == "draws") return ControlDraws(c);
	if (c.name == "newgame") return ProbeNewGame(c);
	if (c.name == "sai") return DumpStrategicAI(c);
	if (c.name == "saievaluate") return ProbeSaiEvaluate(c);
	if (c.name == "saicheck") return ProbeSaiCheck(c);
	if (c.name == "saiwake") return ProbeSaiWake(c);
	if (c.name == "diffmod") return ProbeDifficultyModifier(c);
	if (c.name == "saiarrive") return ProbeSaiArrive(c);
	if (c.name == "edgepoints") return DumpEdgepoints(c);
	if (c.name == "walkoff") return ProbeWalkOff(c);
	if (c.name == "walkin") return ProbeWalkIn(c);
	if (c.name == "mirror") return ProbeMirror(c);
	if (c.name == "soldierexit") return ProbeSoldierExit(c);
	if (c.name == "exitcheck") return ProbeExitCheck(c);
	if (c.name == "move") return MoveSoldier(c);
	if (c.name == "initlist") return ProbeInitList(c);
	if (c.name == "defence") return ProbeDefence(c);
	if (c.name == "options") return SetGameOption(c);
	if (c.name == "setcontrol") return SetSectorControl(c);
	if (c.name == "tacticalflags") return SetTacticalFlags(c);
	if (c.name == "creatures") return DumpCreatures(c);
	if (c.name == "creaturequest") return ProbeCreatureQuest(c);
	if (c.name == "creaturetrigger") return ProbeCreatureTrigger(c);
	if (c.name == "creaturespread") return ProbeCreatureSpread(c);
	if (c.name == "creatureplanning") return ProbeCreaturePlanning(c);
	if (c.name == "creatureattack") return ProbeCreatureAttack(c);
	if (c.name == "endcreaturequest") return ProbeEndCreatureQuest(c);
	if (c.name == "setcreatures") return SetCreatures(c);
	if (c.name == "creaturecomposition") return ProbeCreatureComposition(c);
	if (c.name == "creatureplacement") return ProbeCreaturePlacement(c);
	if (c.name == "bloodcatplacement") return ProbeBloodcatPlacement(c);
	if (c.name == "addsoldier") return AddProbeSoldier(c);
	if (c.name == "setsoldier") return SetProbeSoldier(c);
	if (c.name == "seen") return SetSeen(c);
	if (c.name == "decide") return ProbeDecision(c);
	if (c.name == "beststab") return ProbeBestStab(c);
	if (c.name == "stab") return ProbeStab(c);
	if (c.name == "creaturecall") return ProbeCreatureCall(c);
	if (c.name == "smell") return SetSmell(c);
	if (c.name == "dropsmell") return ProbeDropSmell(c);
	if (c.name == "trackscent") return ProbeTrackScent(c);
	if (c.name == "morale") return DumpMorale(c);
	if (c.name == "setmorale") return SetMorale(c);
	if (c.name == "setrelation") return SetRelation(c);
	if (c.name == "moralecounter") return SetMoraleCounter(c);
	if (c.name == "setprofile") return SetProfileTraits(c);
	if (c.name == "moralemove") return MoveForMorale(c);
	if (c.name == "hourlymorale") return ProbeHourlyMorale(c);
	if (c.name == "quartermorale") return ProbeQuarterHourMorale(c);
	if (c.name == "dealers") return DumpDealers(c);
	if (c.name == "dealerinit") return ProbeDealerInit(c);
	if (c.name == "dealerdaily") return ProbeDealerDaily(c);
	if (c.name == "progress") return SetHighestProgress(c);
	if (c.name == "fact") return SetFactProbe(c);
	if (c.name == "dealerprice") return ProbeDealerPrice(c);
	if (c.name == "dealersell") return ProbeDealerSell(c);
	if (c.name == "shophours") return SetShopHours(c);
	if (c.name == "dealerrepair") return ProbeDealerRepair(c);
	if (c.name == "skiptime") return SkipTime(c);
	if (c.name == "dealergive") return GiveDealerRepair(c);
	if (c.name == "ski") return ProbeShopKeeper(c);
	if (c.name == "contracts") return DumpContracts(c);
	if (c.name == "profiles") return DumpContracts(c);
	if (c.name == "dailyupdate") return ProbeDailyUpdate(c);
	if (c.name == "relationshours") return ProbeRelationsHours(c);
	if (c.name == "settime") return SetContractTime(c);
	if (c.name == "aboutleave") return ProbeAboutToLeave(c);
	if (c.name == "beginrenewal") return ProbeBeginRenewal(c);
	if (c.name == "renewalstep") return ProbeRenewalStep(c);
	if (c.name == "setcontract") return SetContract(c);
	if (c.name == "setstatus") return SetContractStatus(c);
	if (c.name == "setprofilecontract") return SetProfileContract(c);
	if (c.name == "extend") return ProbeExtendContract(c);
	if (c.name == "beginremove") return ProbeBeginRemove(c);
	if (c.name == "removemerc") return ProbeRemoveMerc(c);
	if (c.name == "leaveequip") return ProbeLeaveEquipment(c);
	if (c.name == "equipleft") return ProbeEquipmentDelivered(c);
	if (c.name == "mercsite") return ProbeMercSite(c);
	if (c.name == "levelup") return ProbeLevelUp(c);
	if (c.name == "salary") return ProbeSalary(c);
	if (c.name == "setrenewals") return SetRenewals(c);
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
