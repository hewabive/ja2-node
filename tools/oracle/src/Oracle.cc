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
// @src src/game/Strategic/Game_Init.cc InitNewGame; src/game/Laptop (A.I.M., M.E.R.C., I.M.P., Bobby Ray, insurance)
// @src src/game/Strategic/Map_Screen_Helicopter.cc, MapScreen.cc, Tactical/Vehicles.cc (the helicopter probes)
// @src src/game/Strategic/Quests.cc CheckFact, InternalStartQuest, InternalEndQuest; Hourly_Update.cc; StrategicMap.cc
// @src HandleQuestCodeOnSector (facts probes); src/game/TacticalAI/NPC.cc CalcDesireToTalk, NPCConsiderTalking, ConverseFull
// @src (talk probes); src/game/Strategic/Scheduling.cc, TacticalAI/DecideAction.cc DecideActionSchedule (schedule probes)
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
#include "Interface_Dialogue.h"
#include "NPC.h"
#include "Map_Screen_Interface.h"
#include "Map_Screen_Interface_Border.h"
#include "SamSiteModel.h"
#include "History.h"
#include "Mercs.h"
#include "Smell.h"
#include "Soldier_Macros.h"
#include "BobbyR.h"
#include "BobbyRMailOrder.h"
#include "CharProfile.h"
#include "EMail.h"
#include "Game_Init.h"
#include "IMP_Compile_Character.h"
#include "IMP_Portraits.h"
#include "Insurance_Contract.h"
#include "Merc_Hiring.h"
#include "Strategic_Event_Handler.h"
#include "ShippingDestinationModel.h"
#include "Keys.h"
#include "Handle_Doors.h"
#include "Structure.h"
#include "Boxing.h"
#include "Interface_Dialogue.h"
#include "FileMan.h"
#include "MercProfile.h"
#include "Scheduling.h"

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
bool OracleDoTrapCheckOnStartingMenu(SOLDIERTYPE& s, DOOR& d);
void OracleHostileQuoteList(std::vector<UINT8>* ids);
extern bool gOracleSkyriderSilent;
extern std::vector<UINT16> gOracleSkyriderQuotes;
void OracleMakeHeliReturnToBase();
BOOLEAN OracleRequestGiveSkyriderNewDestination();
void OracleHandleNewDestConfirmation(SGPSector const& sector);
UINT8 OracleNPCConsiderTalking(UINT8 npc, UINT8 merc, Approach approach, UINT8 record, INT32* index);
INT32 OracleCalcThreateningEffectiveness(UINT8 merc);
BOOLEAN OracleNPCConsiderQuote(UINT8 npc, UINT8 merc, Approach approach, UINT8 record, UINT8 desire, NPCQuoteInfo* quotes);
NPCQuoteInfo const* OracleQuoteArray(UINT8 npc, bool backup);
NPCQuoteInfo const* OracleCivQuoteArray(UINT8 index);
extern SOLDIERTYPE* gpSrcSoldier;
extern SOLDIERTYPE* gpDestSoldier;
extern UINT8 gubQuest[MAX_QUESTS];
void OracleHourlyQuestUpdate();
void OracleHourlyCheckIfSlayAloneSoHeCanLeave();
void OracleHandleQuestCodeOnSectorExit(const SGPSector& oldSector);
INT8 OracleDecideActionSchedule(SOLDIERTYPE* s);
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
void LaptopScreenInit(void);
extern UINT8 gubScreenCount;
UINT16 OracleCalcCompetence(ProfileID pid);
UINT16 OracleAimHireDecision(ProfileID pid, BOOLEAN* accepted);
INT8 OracleAimMemberHireMerc(ProfileID pid, UINT8 contractLength, BOOLEAN gear, INT32* amount);
BOOLEAN OracleMercFilesHireMerc(UINT8 ubMercID);
INT32 OracleSettleMercAccounts(UINT8 ubCurMercIndex);
INT32 OracleBobbyRayOrder(UINT8 city, UINT8 speed, UINT32* subtotal, UINT32* shipping);
INT32 OracleInsuranceContractLength(SOLDIERTYPE const* s);
void OracleCompileQuiz(INT32 const* answers);
void OracleIMPConfirmYes();
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
extern bool gOracleSkipDialogueBoxes;
UINT16 OracleDialogueMessageBoxType();
UINT8 OracleLiePromptRecord();
void OracleResetDialogueMessageBox();
void OracleAnswerDialogueMessageBox(UINT16 type, UINT8 record, MessageBoxReturnValue answer);
extern UINT8 gubCambriaMedicalObjects;

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


constexpr UINT8 LAPTOP_EVENTS[] = {
	EVENT_BOBBYRAY_PURCHASE, EVENT_UPDATE_BOBBY_RAY_INVENTORY, EVENT_DAY3_ADD_EMAIL_FROM_SPECK, EVENT_DELAYED_HIRING_OF_MERC,
	EVENT_PAY_LIFE_INSURANCE_FOR_DEAD_MERC, EVENT_DAY2_ADD_EMAIL_FROM_IMP, EVENT_MERC_COMPLAIN_EQUIPMENT, EVENT_SET_BY_NPC_SYSTEM,
	EVENT_INSURANCE_INVESTIGATION_STARTED, EVENT_INSURANCE_INVESTIGATION_OVER, EVENT_MERC_SITE_BACK_ONLINE,
	EVENT_HAVENT_MADE_IMP_CHARACTER_EMAIL, EVENT_MERC_SITE_NEW_MERC_AVAILABLE
};
constexpr ProfileID LAPTOP_TERRORISTS[] = { DRUGGIST, SLAY, ANNIE, CHRIS, TIFFANY, T_REX };

std::string DescribeLaptopEvents()
{
	std::vector<std::string> events;
	for (STRATEGICEVENT const* e = gpEventList; e; e = e->next)
	{
		if (std::find(std::begin(LAPTOP_EVENTS), std::end(LAPTOP_EVENTS), e->ubCallbackID) == std::end(LAPTOP_EVENTS)) continue;
		events.push_back(Numbers({e->uiTimeStamp, e->ubCallbackID, e->uiParam}));
	}
	return JsonArray(events);
}

std::string DescribeStore(STORE_INVENTORY const* inv, UINT16 length)
{
	std::vector<std::string> slots;
	for (UINT16 i = 0; i < length; ++i)
	{
		STORE_INVENTORY const& s = inv[i];
		slots.push_back(Numbers({s.usItemIndex, s.ubQtyOnHand, s.ubQtyOnOrder, s.ubItemQuality, s.fPreviouslyEligible}));
	}
	return JsonArray(slots);
}

std::string DescribeShipments()
{
	std::vector<std::string> shipments;
	for (NewBobbyRayOrderStruct const& o : gpNewBobbyrShipments)
	{
		std::vector<std::string> lines;
		for (UINT8 i = 0; i < o.ubNumberPurchases; ++i)
		{
			BobbyRayPurchaseStruct const& l = o.BobbyRayPurchase[i];
			lines.push_back(Numbers({l.usItemIndex, l.ubNumberPurchased, l.bItemQuality, l.usBobbyItemIndex, l.fUsed}));
		}
		shipments.push_back(Json{}
			.flag("active", o.fActive)
			.num("destination", o.ubDeliveryLoc)
			.num("speed", o.ubDeliveryMethod)
			.raw("lines", JsonArray(lines))
			.num("weight", o.uiPackageWeight)
			.num("day", o.uiOrderedOnDayNum)
			.flag("shown", o.fDisplayedInShipmentPage)
			.text());
	}
	return JsonArray(shipments);
}

std::string DescribeEmails()
{
	std::vector<std::string> mails;
	for (Email const* m = pEmailList; m; m = m->Next)
		mails.push_back(Numbers({m->usOffset, m->usLength, m->ubSender, m->iDate, m->iFirstData, m->uiSecondData, m->fRead}));
	return JsonArray(mails);
}

std::string DescribePayouts()
{
	std::vector<std::string> payouts;
	for (LIFE_INSURANCE_PAYOUT const& p : LaptopSaveInfo.pLifeInsurancePayouts)
		payouts.push_back(Numbers({p.fActive, p.ubSoldierID, p.ubMercID, p.iPayOutPrice}));
	return JsonArray(payouts);
}

std::string DescribeLaptop()
{
	LaptopSaveInfoStruct const& l = LaptopSaveInfo;
	std::vector<long long> bookmarks;
	for (INT32 const b : l.iBookMarkList)
	{
		if (b == -1) break;
		bookmarks.push_back(b);
	}
	std::vector<long long> dead, left, other;
	for (INT32 i = 0; i < 256; ++i)
	{
		if (l.ubDeadCharactersList[i] != -1) dead.push_back(l.ubDeadCharactersList[i]);
		if (l.ubLeftCharactersList[i] != -1) left.push_back(l.ubLeftCharactersList[i]);
		if (l.ubOtherCharactersList[i] != -1) other.push_back(l.ubOtherCharactersList[i]);
	}
	return Json{}
		.flag("newGame", l.gfNewGameLaptop)
		.nums("bookmarks", bookmarks)
		.num("balance", l.iCurrentBalance)
		.raw("imp", Numbers({l.fIMPCompletedFlag, l.fSentImpWarningAlready}))
		.raw("personnel", Json{}.nums("dead", dead).nums("left", left).nums("other", other).text())
		.raw("merc", Numbers({l.gubPlayersMercAccountStatus, l.gubLastMercIndex, l.ubLastMercAvailableId, l.uiTotalMoneyPaidToSpeck,
			l.fMercSiteHasGoneDownYet, l.fFirstVisitSinceServerWentDown, l.fNewMercsAvailableAtMercSite, l.ubPlayerBeenToMercSiteStatus,
			l.uiSpeckQuoteFlags, l.ubSpeckCanSayPlayersLostQuote, l.fSaidGenericOpeningInMercSite, l.fSpeckSaidFloMarriedCousinQuote,
			l.fHasAMercDiedAtMercSite}))
		.raw("bobbyRay", Numbers({l.fBobbyRSiteCanBeAccessed, l.ubHaveBeenToBobbyRaysAtLeastOnceWhileUnderConstruction}))
		.raw("newStock", DescribeStore(l.BobbyRayInventory, l.usInventoryListLength[BOBBY_RAY_NEW]))
		.raw("usedStock", DescribeStore(l.BobbyRayUsedInventory, l.usInventoryListLength[BOBBY_RAY_USED]))
		.raw("shipments", DescribeShipments())
		.raw("payouts", DescribePayouts())
		.num("payoutsUsed", l.ubNumberLifeInsurancePayoutUsed)
		.raw("mails", DescribeEmails())
		.num("arriveSector", g_merc_arrive_sector.AsByte())
		.flag("hired", gfAtLeastOneMercWasHired)
		.raw("events", DescribeLaptopEvents())
		.num("worldMinutes", GetWorldTotalMin())
		.text();
}

std::string DescribeLaptopProfile(ProfileID const pid)
{
	MERCPROFILESTRUCT const& p = GetProfile(pid);
	std::vector<long long> inventory;
	for (UINT16 const item : p.inv) inventory.push_back(item);
	std::vector<long long> statuses, counts;
	for (UINT8 const v : p.bInvStatus) statuses.push_back(v);
	for (UINT8 const v : p.bInvNumber) counts.push_back(v);
	return Json{}
		.num("id", pid)
		.num("status", p.bMercStatus)
		.num("available", p.uiDayBecomesAvailable)
		.raw("salaries", Numbers({p.sSalary, p.uiWeeklySalary, p.uiBiWeeklySalary}))
		.raw("deposit", Numbers({p.bMedicalDeposit, p.sMedicalDepositAmount}))
		.num("gear", p.usOptionalGearCost)
		.num("competence", OracleCalcCompetence(pid))
		.raw("attractiveness", Numbers({p.bMainGunAttractiveness, p.bArmourAttractiveness}))
		.num("flags", p.ubMiscFlags)
		.num("flags3", p.ubMiscFlags3)
		.num("hangover", p.ubDaysOfMoraleHangover)
		.num("precedent", p.uiPrecedentQuoteSaid)
		.num("mercDays", p.iMercMercContractLength)
		.raw("sector", Numbers({p.sSector.x, p.sSector.y, p.sSector.z}))
		.raw("traits", Numbers({p.bSkillTrait, p.bSkillTrait2, p.bPersonalityTrait, p.bAttitude, p.ubBodyType, p.bSex}))
		.raw("stats", Numbers({p.bLifeMax, p.bAgility, p.bDexterity, p.bWisdom, p.bMedical, p.bExplosive, p.bMechanical, p.bMarksmanship,
			p.bExpLevel, p.bStrength, p.bLeadership, p.bLife}))
		.raw("inventory", Numbers(inventory))
		.raw("invStatus", Numbers(statuses))
		.raw("invCount", Numbers(counts))
		.flag("taken", p.impSlotState == IMPSlotState::TAKEN)
		.text();
}

std::vector<ProfileID> LaptopProfileSelection(Command const& c)
{
	std::vector<ProfileID> ids;
	if (Has(c, "range"))
	{
		std::vector<std::string> const bounds = SplitList(Text(c, "range", ""), ':');
		if (bounds.size() != 2) throw std::runtime_error("range needs <from>:<to>");
		for (long long id = ParseInteger("range", bounds[0]); id < ParseInteger("range", bounds[1]); ++id) ids.push_back(static_cast<ProfileID>(id));
	}
	else if (Has(c, "who"))
	{
		for (std::string const& part : SplitList(Text(c, "who", ""), ',')) ids.push_back(static_cast<ProfileID>(ParseInteger("who", part)));
	}
	return ids;
}

void EmitLaptop(Command const& c, std::string const& draws, std::string const& result, std::vector<ProfileID> const& profiles)
{
	std::vector<std::string> mercs;
	std::vector<std::string> inventories;
	FOR_EACH_IN_TEAM(s, OUR_TEAM)
	{
		mercs.push_back(DescribeContractMerc(*s));
		std::vector<std::string> slots;
		for (OBJECTTYPE const& o : s->inv) slots.push_back(Numbers({o.usItem, o.ubNumberOfObjects, o.bStatus[0]}));
		inventories.push_back(JsonArray(slots));
	}
	std::vector<std::string> dumped;
	for (ProfileID const id : profiles) dumped.push_back(DescribeLaptopProfile(id));
	Json json;
	json.str("probe", c.name).num("line", c.line).raw("args", DescribeArgs(c));
	if (!draws.empty()) json.raw("draws", draws);
	if (!result.empty()) json.raw("result", result);
	json.raw("laptop", DescribeLaptop()).raw("mercs", JsonArray(mercs)).raw("inventories", JsonArray(inventories))
		.raw("profiles", JsonArray(dumped));
	Emit(json);
}

void ProbeNewGameFull(Command const& c)
{
	gGameOptions.ubDifficultyLevel = static_cast<UINT8>(Integer(c, "difficulty", DIF_LEVEL_MEDIUM));
	gGameOptions.fGunNut = Integer(c, "gunnut", 0) != 0;
	gGameOptions.fSciFi = Integer(c, "scifi", 1) != 0;
	if (Has(c, "seed")) OracleSeedRandom(static_cast<UINT32>(Integer(c, "seed", 0)), TRUE);
	GCM->resetMercProfileStructs();
	ShutDownEmailList();
	LaptopScreenInit();
	gubScreenCount = 0;
	std::string const draws = TracedSaiDraws([] { InitNewGame(); });
	std::vector<std::string> terrorists;
	for (ProfileID const pid : LAPTOP_TERRORISTS) terrorists.push_back(Numbers({pid, GetProfile(pid).sSector.x, GetProfile(pid).sSector.y}));
	std::vector<ProfileID> all;
	for (ProfileID id = 0; id < NUM_PROFILES; ++id) all.push_back(id);
	EmitLaptop(c, draws, Json{}.raw("terrorists", JsonArray(terrorists)).num("count", gubNumTerrorists).text(), all);
}

void ProbeArrivalTimes(Command const& c)
{
	UINT32 const saved[] = {guiGameClock, guiDay, guiHour, guiMin};
	std::vector<long long> times;
	for (UINT32 hour = 0; hour < 24; ++hour)
	{
		guiDay = 2;
		guiHour = hour;
		guiMin = 30;
		guiGameClock = guiDay * NUM_SEC_IN_DAY + hour * NUM_SEC_IN_HOUR + guiMin * NUM_SEC_IN_MIN;
		times.push_back(GetMercArrivalTimeOfDay());
	}
	guiGameClock = saved[0];
	guiDay = saved[1];
	guiHour = saved[2];
	guiMin = saved[3];
	Emit(Json{}.str("probe", "arrival").num("line", c.line).nums("times", times));
}

void DumpLaptop(Command const& c)
{
	EmitLaptop(c, "", "", LaptopProfileSelection(c));
}

UINT8 AimContractCode(long long days)
{
	switch (days)
	{
		case 1:  return 0;
		case 7:  return 1;
		case 14: return 2;
		default: throw std::runtime_error("contract must be 1, 7 or 14");
	}
}

void ProbeAimHire(Command const& c)
{
	ProfileID const pid = static_cast<ProfileID>(Required(c, "profile"));
	UINT8 const contract = AimContractCode(Integer(c, "contract", 7));
	BOOLEAN const gear = Integer(c, "gear", GetProfile(pid).usOptionalGearCost != 0) != 0;
	BOOLEAN accepted = FALSE;
	UINT16 quote = QUOTE_NONE;
	INT8 hired = -3;
	INT32 amount = 0;
	std::string const draws = TracedSaiDraws([&] {
		quote = OracleAimHireDecision(pid, &accepted);
		if (accepted) hired = OracleAimMemberHireMerc(pid, contract, gear, &amount);
	});
	EmitLaptop(c, draws, Json{}.flag("accepted", accepted).num("quote", quote).num("hired", hired).num("amount", amount).text(), {pid});
}

void ProbeMercAccount(Command const& c)
{
	std::string const draws = TracedSaiDraws([] {
		LaptopSaveInfo.gubPlayersMercAccountStatus = MERC_ACCOUNT_VALID;
		LaptopSaveInfo.guiPlayersMercAccountNumber = Random(99999);
	});
	EmitLaptop(c, draws, "", {});
}

void ProbeMercHire(Command const& c)
{
	ProfileID const pid = static_cast<ProfileID>(Required(c, "profile"));
	BOOLEAN hired = FALSE;
	std::string const draws = TracedSaiDraws([&] { hired = OracleMercFilesHireMerc(pid); });
	EmitLaptop(c, draws, Json{}.flag("hired", hired).text(), {pid});
}

void ProbeMercPay(Command const& c)
{
	INT32 total = 0;
	std::string const draws = TracedSaiDraws([&] { total = OracleSettleMercAccounts(static_cast<UINT8>(Integer(c, "index", 0))); });
	EmitLaptop(c, draws, Json{}.num("total", total).text(), LaptopProfileSelection(c));
}

void ProbeBobbyRestock(Command const& c)
{
	std::string const draws = TracedSaiDraws([] {
		DailyUpdateOfBobbyRaysNewInventory();
		DailyUpdateOfBobbyRaysUsedInventory();
	});
	EmitLaptop(c, draws, "", {});
}

void ProbeBobbyFresh(Command const& c)
{
	std::string const draws = TracedSaiDraws([&] { AddFreshBobbyRayInventory(static_cast<UINT16>(Required(c, "param"))); });
	EmitLaptop(c, draws, "", {});
}

void ProbeBobbyOrder(Command const& c)
{
	std::fill_n(BobbyRayPurchases, MAX_PURCHASE_AMOUNT, BobbyRayPurchaseStruct{});
	UINT8 n = 0;
	for (std::string const& line : SplitList(Text(c, "lines", ""), ','))
	{
		std::vector<std::string> const parts = SplitList(line, ':');
		UINT16 const item = static_cast<UINT16>(ParseInteger("lines", parts.at(0)));
		UINT8 const count = static_cast<UINT8>(ParseInteger("lines", parts.at(1)));
		BOOLEAN const used = parts.size() > 2 && ParseInteger("lines", parts[2]) != 0;
		STORE_INVENTORY* const inv = used ? LaptopSaveInfo.BobbyRayUsedInventory : LaptopSaveInfo.BobbyRayInventory;
		INT16 const slot = GetInventorySlotForItem(inv, item, used);
		if (slot < 0) throw std::runtime_error("item not in Bobby Ray's list");
		BobbyRayPurchaseStruct& p = BobbyRayPurchases[n++];
		p.usItemIndex = item;
		p.ubNumberPurchased = count;
		p.bItemQuality = used ? inv[slot].ubItemQuality : 100;
		p.usBobbyItemIndex = slot;
		p.fUsed = used;
	}
	UINT32 subtotal = 0;
	UINT32 shipping = 0;
	INT32 total = 0;
	std::string const draws = TracedSaiDraws([&] {
		total = OracleBobbyRayOrder(static_cast<UINT8>(Required(c, "dest")), static_cast<UINT8>(Integer(c, "speed", 0)), &subtotal, &shipping);
	});
	EmitLaptop(c, draws, Json{}.num("subtotal", subtotal).num("shipping", shipping).num("total", total).text(), {});
}

void ProbeBobbyDeliver(Command const& c)
{
	UINT8 const index = static_cast<UINT8>(Integer(c, "index", 0));
	if (index >= gpNewBobbyrShipments.size()) throw std::runtime_error("no such shipment");
	GridNo const grid = GCM->getShippingDestination(gpNewBobbyrShipments[index].ubDeliveryLoc)->deliverySectorGridNo;
	std::string const draws = TracedSaiDraws([&] { BobbyRayPurchaseEventCallback(index); });
	std::vector<long long> facts;
	for (Fact const f : {FACT_PABLOS_STOLE_FROM_LATEST_SHIPMENT, FACT_LAST_SHIPMENT_CRASHED, FACT_LAST_SHIPMENT_WENT_TO_WRONG_AIRPORT,
		FACT_AGENTS_PREVENTED_SHIPMENT, FACT_MEDIUM_SIZED_SHIPMENT_WAITING, FACT_LARGE_SIZED_SHIPMENT_WAITING,
		FACT_REALLY_NEW_BOBBYRAY_SHIPMENT_WAITING, FACT_LARGE_SIZED_OLD_SHIPMENT_WAITING})
		facts.push_back(gubFact[f]);
	std::vector<std::string> items;
	for (WORLDITEM const& w : gWorldItems)
	{
		if (!w.fExists || (w.sGridNo != grid && w.sGridNo != LOST_SHIPMENT_GRIDNO)) continue;
		items.push_back(Numbers({w.sGridNo, w.o.usItem, w.o.ubNumberOfObjects, w.o.bStatus[0], w.bVisible}));
	}
	EmitLaptop(c, draws, Json{}.nums("facts", facts).raw("worldItems", JsonArray(items)).text(), {});
}

void SetLaptopBalance(Command const& c)
{
	INT32 const delta = static_cast<INT32>(Required(c, "amount")) - LaptopSaveInfo.iCurrentBalance;
	AddTransactionToPlayersBook(ANONYMOUS_DEPOSIT, 0, GetWorldTotalMin(), delta);
	Emit(Json{}.str("probe", "setbalance").num("line", c.line).num("balance", LaptopSaveInfo.iCurrentBalance));
}

void ProbeFactValue(Command const& c)
{
	Fact const f = static_cast<Fact>(Required(c, "id"));
	gubFact[f] = static_cast<UINT8>(Integer(c, "value", 1));
	Emit(Json{}.str("probe", "setfact").num("line", c.line).num("id", f).num("value", gubFact[f]));
}

void ProbeInsure(Command const& c)
{
	SOLDIERTYPE& s = GetMan(static_cast<SoldierID>(Required(c, "who")));
	INT32 const length = OracleInsuranceContractLength(&s);
	INT32 const cost = CalculateInsuranceContractCost(length, s.ubProfile);
	if (Integer(c, "buy", 1) != 0 && length > 0) PurchaseOrExtendInsuranceForSoldier(&s, length);
	EmitLaptop(c, "", Json{}.num("length", length).num("cost", cost).text(), {s.ubProfile});
}

void ProbeInsuranceDaily(Command const& c)
{
	DailyUpdateOfInsuredMercs();
	EmitLaptop(c, "", "", {});
}

void ProbeInsurancePayout(Command const& c)
{
	SOLDIERTYPE& s = GetMan(static_cast<SoldierID>(Required(c, "who")));
	if (Has(c, "suspicious")) GetProfile(s.ubProfile).ubSuspiciousDeath = static_cast<UINT8>(Integer(c, "suspicious", 0));
	AddLifeInsurancePayout(&s);
	EmitLaptop(c, "", "", {s.ubProfile});
}

void ProbeInsuranceStep(Command const& c)
{
	UINT8 const slot = static_cast<UINT8>(Integer(c, "slot", 0));
	if (slot >= LaptopSaveInfo.pLifeInsurancePayouts.size()) throw std::runtime_error("no such payout");
	std::string const step = Text(c, "step", "pay");
	std::string const draws = TracedSaiDraws([&] {
		if (step == "start") StartInsuranceInvestigation(slot);
		else if (step == "end") EndInsuranceInvestigation(slot);
		else InsuranceContractPayLifeInsuranceForDeadMerc(slot);
	});
	EmitLaptop(c, draws, "", {});
}

void ProbeImpCreate(Command const& c)
{
	bool const male = Text(c, "gender", "male") == "male";
	std::vector<std::string> const answers = SplitList(Text(c, "answers", ""), ',');
	std::vector<std::string> const attrs = SplitList(Text(c, "attrs", ""), ',');
	if (answers.size() != 16 || attrs.size() != 10) throw std::runtime_error("imp needs 16 answers and 10 attributes");
	INT32 quiz[16];
	for (int i = 0; i < 16; ++i) quiz[i] = static_cast<INT32>(ParseInteger("answers", answers[i]));
	fCharacterIsMale = male;
	pFullName = Text(c, "name", "Oracle Test").c_str();
	pNickName = Text(c, "nick", "Oracle").c_str();
	INT32* const targets[] = {&iHealth, &iAgility, &iDexterity, &iStrength, &iWisdom, &iLeadership, &iMarksmanship, &iMedical,
		&iMechanical, &iExplosives};
	for (int i = 0; i < 10; ++i) *targets[i] = static_cast<INT32>(ParseInteger("attrs", attrs[i]));
	iPortraitNumber = GetIMPPortraitIndex(male, static_cast<INT32>(Integer(c, "portrait", 0)));
	LaptopSaveInfo.iVoiceId = GetIMPVoiceIndex(male, static_cast<INT32>(Integer(c, "voice", 0)));
	ProfileID const slot = GetIMPSlotInProgress();
	std::string const draws = TracedSaiDraws([&] {
		ResetSkillsAttributesAndPersonality();
		OracleCompileQuiz(quiz);
		CreatePlayersPersonalitySkillsAndAttitude();
		CreateACharacterFromPlayerEnteredStats();
		OracleIMPConfirmYes();
	});
	EmitLaptop(c, draws, Json{}.num("slot", slot).text(), {slot});
}



std::map<std::string, HandleDoor> const DOOR_HANDLE_CODES{
	{"open", HANDLE_DOOR_OPEN}, {"examine", HANDLE_DOOR_EXAMINE}, {"pickLock", HANDLE_DOOR_LOCKPICK}, {"force", HANDLE_DOOR_FORCE},
	{"lock", HANDLE_DOOR_LOCK}, {"unlock", HANDLE_DOOR_UNLOCK}, {"explode", HANDLE_DOOR_EXPLODE}, {"untrap", HANDLE_DOOR_UNTRAP},
	{"crowbar", HANDLE_DOOR_CROWBAR},
};

std::string DescribeDoorEntry(GridNo const g)
{
	DOOR const* const d = FindDoorInfoAtGridNo(g);
	STRUCTURE const* const st = FindStructure(g, STRUCTURE_ANYDOOR);
	Json j;
	j.num("gridNo", g).flag("present", d != nullptr).flag("open", st && (st->fFlags & STRUCTURE_OPEN));
	if (d)
	{
		j.flag("locked", d->fLocked).num("trapId", d->ubTrapID).num("trapLevel", d->ubTrapLevel).num("lockId", d->ubLockID)
			.num("perceivedLocked", d->bPerceivedLocked).num("perceivedTrapped", d->bPerceivedTrapped).num("lockDamage", d->bLockDamage);
	}
	return j.text();
}

std::string DescribeDoorSoldier(SOLDIERTYPE const& s)
{
	std::vector<std::string> inventory;
	for (int slot = 0; slot < NUM_INV_SLOTS; ++slot)
	{
		OBJECTTYPE const& o = s.inv[slot];
		if (o.usItem == NOTHING) continue;
		inventory.push_back(Numbers({slot, o.usItem, o.bStatus[0], o.ubNumberOfObjects, o.ubKeyID}));
	}
	std::vector<std::string> ring;
	if (s.pKeyRing)
	{
		for (int k = 0; k < NUM_KEYS; ++k)
		{
			if (s.pKeyRing[k].ubNumber != 0) ring.push_back(Numbers({k, s.pKeyRing[k].ubKeyID, s.pKeyRing[k].ubNumber}));
		}
	}
	Json j;
	j.num("id", s.ubID).num("gridNo", s.sGridNo).num("ap", s.bActionPoints).num("life", s.bLife).num("breath", s.bBreath)
		.num("breathMax", s.bBreathMax).num("bleeding", s.bBleeding).num("lastSkillCheck", s.bLastSkillCheck)
		.num("skillCheckAttempts", s.ubSkillCheckAttempts).num("skillCheckGridNo", s.sSkillCheckGridNo)
		.num("doorHandleCode", s.ubDoorHandleCode).num("beingAttacked", s.bBeingAttackedCount).num("side", static_cast<int>(s.bSide))
		.flag("neutral", s.bNeutral).num("team", s.bTeam).raw("inventory", JsonArray(inventory)).raw("keyRing", JsonArray(ring));
	if (s.ubProfile != NO_PROFILE)
	{
		MERCPROFILESTRUCT const& p = GetProfile(s.ubProfile);
		j.raw("gains", Numbers({p.sLifeGain, p.sAgilityGain, p.sDexterityGain, p.sWisdomGain, p.sMedicalGain, p.sExplosivesGain,
			p.sMechanicGain, p.sMarksmanshipGain, p.sExpLevelGain, p.sStrengthGain, p.sLeadershipGain}));
		j.raw("stats", Numbers({s.bLifeMax, s.bAgility, s.bDexterity, s.bWisdom, s.bMedical, s.bExplosive, s.bMechanical,
			s.bMarksmanship, s.bExpLevel, s.bStrength, s.bLeadership}));
	}
	return j.text();
}

void ApplyDoorSettings(Command const& c, GridNo const g)
{
	STRUCTURE const* const st = FindStructure(g, STRUCTURE_ANYDOOR);
	if (Integer(c, "close", 0) != 0 && st && (st->fFlags & STRUCTURE_OPEN)) HandleDoorChangeFromGridNo(nullptr, g, TRUE);
	DOOR* d = FindDoorInfoAtGridNo(g);
	if (Has(c, "remove") && d)
	{
		RemoveDoorInfoFromTable(g);
		return;
	}
	if (!d && Has(c, "lock"))
	{
		DOOR fresh{};
		fresh.sGridNo = static_cast<INT16>(g);
		AddDoorInfoToTable(&fresh);
		d = FindDoorInfoAtGridNo(g);
	}
	if (!d) return;
	if (Has(c, "locked")) d->fLocked = Integer(c, "locked", 0) != 0;
	SetIfGiven(c, "trap", d->ubTrapID);
	SetIfGiven(c, "level", d->ubTrapLevel);
	SetIfGiven(c, "lock", d->ubLockID);
	SetIfGiven(c, "damage", d->bLockDamage);
	SetIfGiven(c, "perceivedLocked", d->bPerceivedLocked);
	SetIfGiven(c, "perceivedTrapped", d->bPerceivedTrapped);
}

void ApplyDoorItems(Command const& c, SOLDIERTYPE& s)
{
	for (char const* key : {"give1", "give2", "give3"})
	{
		if (!Has(c, key)) continue;
		std::vector<std::string> const parts = SplitList(Text(c, key, ""), ':');
		if (parts.size() < 4) throw std::runtime_error("give looks like <slot>:<item>:<status>:<count>[:<keyId>]");
		int const slot = static_cast<int>(ParseInteger(key, parts[0]));
		CreateItems(static_cast<UINT16>(ParseInteger(key, parts[1])), static_cast<INT8>(ParseInteger(key, parts[2])),
			static_cast<UINT8>(ParseInteger(key, parts[3])), &s.inv[slot]);
		if (parts.size() > 4) s.inv[slot].ubKeyID = static_cast<UINT8>(ParseInteger(key, parts[4]));
	}
	if (Has(c, "clear"))
	{
		for (std::string const& part : SplitList(Text(c, "clear", ""), ':')) DeleteObj(&s.inv[ParseInteger("clear", part)]);
	}
	if (Has(c, "ring") && s.pKeyRing)
	{
		std::vector<std::string> const parts = SplitList(Text(c, "ring", ""), ':');
		if (parts.size() != 2) throw std::runtime_error("ring looks like <keyId>:<count>");
		s.pKeyRing[0].ubKeyID = static_cast<UINT8>(ParseInteger("ring", parts[0]));
		s.pKeyRing[0].ubNumber = static_cast<UINT8>(ParseInteger("ring", parts[1]));
	}
}

void ApplyDoorSoldier(Command const& c, SOLDIERTYPE& s)
{
	ApplySoldierSettings(c, s);
	SetIfGiven(c, "bleeding", s.bBleeding);
	SetIfGiven(c, "shock", s.bShock);
	SetIfGiven(c, "explosives", s.bExplosive);
	SetIfGiven(c, "mechanical", s.bMechanical);
	SetIfGiven(c, "strength", s.bStrength);
	SetIfGiven(c, "dexterity", s.bDexterity);
	SetIfGiven(c, "wisdom", s.bWisdom);
	SetIfGiven(c, "expLevel", s.bExpLevel);
	SetIfGiven(c, "lastSkillCheck", s.bLastSkillCheck);
	SetIfGiven(c, "skillCheckGridNo", s.sSkillCheckGridNo);
	SetIfGiven(c, "skillCheckAttempts", s.ubSkillCheckAttempts);
	ApplyDoorItems(c, s);
}

void ProbeDoor(Command const& c)
{
	SOLDIERTYPE& s = ExistingSoldier(Required(c, "who"));
	GridNo const g = GridArgument(c, "g");
	ApplyDoorSettings(c, g);
	ApplyDoorSoldier(c, s);
	std::string const action = Text(c, "action", "open");
	HandleDoor const code = Lookup(DOOR_HANDLE_CODES, c, "action", "open");
	STRUCTURE* const st = FindStructure(g, STRUCTURE_ANYDOOR);
	if (!st) throw std::runtime_error("no door at " + std::to_string(g));
	std::string const before = DescribeDoorEntry(g);
	std::string const soldierBefore = DescribeDoorSoldier(s);
	s.ubDoorHandleCode = static_cast<UINT8>(Integer(c, "code", code));
	BOOLEAN handled = FALSE;
	UINT32 const savedFlags = gTacticalStatus.uiFlags;
	if (Integer(c, "incombat", 0) != 0) gTacticalStatus.uiFlags |= INCOMBAT;
	std::string const draws = TracedSaiDraws([&] { handled = HandleOpenableStruct(&s, g, st); });
	gTacticalStatus.uiFlags = savedFlags;
	Emit(Json{}
		.str("probe", "door")
		.num("line", c.line)
		.raw("args", DescribeArgs(c))
		.num("who", s.ubID)
		.num("gridNo", g)
		.str("action", action)
		.num("code", s.ubDoorHandleCode)
		.flag("handled", handled)
		.flag("inCombat", (gTacticalStatus.uiFlags & INCOMBAT) != 0)
		.num("attackBusy", gTacticalStatus.ubAttackBusyCount)
		.raw("before", before)
		.raw("door", DescribeDoorEntry(g))
		.raw("soldierBefore", soldierBefore)
		.raw("soldier", DescribeDoorSoldier(s))
		.num("preRandomIndex", guiPreRandomIndex)
		.raw("draws", draws));
}

void ProbeDoorMenu(Command const& c)
{
	SOLDIERTYPE& s = ExistingSoldier(Required(c, "who"));
	GridNo const g = GridArgument(c, "g");
	ApplyDoorSettings(c, g);
	ApplyDoorSoldier(c, s);
	DOOR* const d = FindDoorInfoAtGridNo(g);
	if (!d) throw std::runtime_error("no door table entry at " + std::to_string(g));
	std::string const before = DescribeDoorEntry(g);
	std::string const soldierBefore = DescribeDoorSoldier(s);
	bool noticed = false;
	std::string const draws = TracedSaiDraws([&] { noticed = OracleDoTrapCheckOnStartingMenu(s, *d); });
	Emit(Json{}
		.str("probe", "doormenu")
		.num("line", c.line)
		.raw("args", DescribeArgs(c))
		.num("who", s.ubID)
		.num("gridNo", g)
		.flag("noticed", noticed)
		.raw("before", before)
		.raw("door", DescribeDoorEntry(g))
		.raw("soldierBefore", soldierBefore)
		.raw("draws", draws));
}

void DumpLockTable(Command const& c)
{
	std::vector<std::string> locks;
	for (int id = 0; id < NUM_LOCKS; ++id)
	{
		LOCK const& l = LockTable[id];
		locks.push_back(Numbers({id, l.usKeyItem, l.ubLockType, l.ubPickDifficulty, l.ubSmashDifficulty}));
	}
	Emit(Json{}.str("probe", "locks").num("line", c.line).raw("locks", JsonArray(locks)));
}

std::string DescribeCivState()
{
	std::vector<long long> groups;
	for (int g = 0; g < NUM_CIV_GROUPS; ++g) groups.push_back(gTacticalStatus.fCivGroupHostile[g]);
	std::vector<std::string> people;
	FOR_EACH_SOLDIER(s)
	{
		if (!s->bInSector) continue;
		if (s->bTeam != CIV_TEAM && s->bTeam != MILITIA_TEAM && s->bTeam != OUR_TEAM) continue;
		people.push_back(Numbers({s->ubID, s->bTeam, static_cast<int>(s->bSide), s->bNeutral, s->ubCivilianGroup, s->bOppCnt, s->ubProfile}));
	}
	std::vector<UINT8> list;
	OracleHostileQuoteList(&list);
	std::vector<long long> listed(list.begin(), list.end());
	std::vector<std::string> events;
	for (STRATEGICEVENT const* e = gpEventList; e; e = e->next)
	{
		if (e->ubCallbackID == EVENT_MAKE_CIV_GROUP_HOSTILE_ON_NEXT_SECTOR_ENTRANCE) events.push_back(Numbers({e->uiTimeStamp, e->uiParam}));
	}
	return Json{}
		.nums("groups", groups)
		.raw("people", JsonArray(people))
		.nums("hostileList", listed)
		.raw("civGroupEvents", JsonArray(events))
		.flag("inCombat", (gTacticalStatus.uiFlags & INCOMBAT) != 0)
		.num("worldMinutes", GetWorldTotalMin())
		.text();
}

void SetCivGroupState(Command const& c)
{
	for (std::string const& spec : SplitList(Text(c, "set", ""), ','))
	{
		std::vector<std::string> const parts = SplitList(spec, ':');
		if (parts.size() != 2) throw std::runtime_error("set looks like <group>:<hostility>[,...]");
		gTacticalStatus.fCivGroupHostile[ParseInteger("set", parts[0])] = static_cast<UINT8>(ParseInteger("set", parts[1]));
	}
	for (std::string const& spec : SplitList(Text(c, "neutral", ""), ','))
	{
		std::vector<std::string> const parts = SplitList(spec, ':');
		if (parts.size() != 2) throw std::runtime_error("neutral looks like <id>:<0|1>[,...]");
		GetMan(static_cast<SoldierID>(ParseInteger("neutral", parts[0]))).bNeutral = ParseInteger("neutral", parts[1]) != 0;
	}
	for (std::string const& spec : SplitList(Text(c, "group", ""), ','))
	{
		std::vector<std::string> const parts = SplitList(spec, ':');
		if (parts.size() != 2) throw std::runtime_error("group looks like <id>:<civ group>[,...]");
		GetMan(static_cast<SoldierID>(ParseInteger("group", parts[0]))).ubCivilianGroup = static_cast<UINT8>(ParseInteger("group", parts[1]));
	}
	Emit(Json{}.str("probe", "civgroups").num("line", c.line).raw("args", DescribeArgs(c)).raw("state", DescribeCivState()));
}

void ProbeMakeCivHostile(Command const& c)
{
	SOLDIERTYPE& s = ExistingSoldier(Required(c, "who"));
	std::string const before = DescribeCivState();
	std::string const draws = TracedSaiDraws([&] { MakeCivHostile(&s); });
	Emit(Json{}.str("probe", "makecivhostile").num("line", c.line).raw("args", DescribeArgs(c)).num("who", s.ubID).raw("before", before).raw("state", DescribeCivState()).raw("draws", draws));
}

void ProbePcAttack(Command const& c)
{
	SOLDIERTYPE& attacker = ExistingSoldier(Required(c, "who"));
	SOLDIERTYPE& target = ExistingSoldier(Required(c, "target"));
	target.attacker = &attacker;
	std::string const before = DescribeCivState();
	BOOLEAN combat = FALSE;
	std::string const draws = TracedSaiDraws([&] { combat = ProcessImplicationsOfPCAttack(&attacker, &target, REASON_NORMAL_ATTACK); });
	Emit(Json{}
		.str("probe", "pcattack")
		.num("line", c.line)
		.raw("args", DescribeArgs(c))
		.num("who", attacker.ubID)
		.num("target", target.ubID)
		.flag("enterCombat", combat)
		.raw("before", before)
		.raw("state", DescribeCivState())
		.raw("draws", draws));
}

void ProbeHostileList(Command const& c)
{
	std::string const before = DescribeCivState();
	std::string const draws = TracedSaiDraws([] { CheckHostileOrSayQuoteList(); });
	Emit(Json{}.str("probe", "hostilelist").num("line", c.line).raw("before", before).raw("state", DescribeCivState()).raw("draws", draws));
}


std::string HeliGroup(GROUP const& g)
{
	std::vector<std::string> waypoints;
	for (WAYPOINT const* w = g.pWaypoints; w; w = w->next) waypoints.push_back(StrategicSector(w->sSector));
	std::vector<long long> members;
	CFOR_EACH_PLAYER_IN_GROUP(p, &g) members.push_back(p->pSoldier->ubID);
	return Json{}
		.num("id", g.ubGroupID)
		.num("size", g.ubGroupSize)
		.raw("sector", StrategicSector(g.ubSector))
		.raw("next", Numbers({g.ubNext.x, g.ubNext.y}))
		.raw("prev", Numbers({g.ubPrev.x, g.ubPrev.y}))
		.flag("betweenSectors", g.fBetweenSectors)
		.num("arrivalTime", g.uiArrivalTime)
		.num("traverseTime", g.uiTraverseTime)
		.num("nextWaypointId", g.ubNextWaypointID)
		.num("transportMask", g.ubTransportationMask)
		.raw("waypoints", JsonArray(waypoints))
		.raw("members", Numbers(members))
		.text();
}

std::string HeliState()
{
	Json j;
	j.num("vehicleId", iHelicopterVehicleId)
		.flag("setUp", fSkyRiderSetUp)
		.flag("airborne", fHelicopterIsAirBorne)
		.flag("returning", fHeliReturnStraightToBase)
		.flag("hovering", fHoveringHelicopter)
		.num("startHover", uiStartHoverTime)
		.num("cost", iTotalAccumulatedCostByPlayer)
		.flag("destroyed", fHelicopterDestroyed)
		.num("talk", guiHelicopterSkyriderTalkState)
		.num("lastMonologue", guiTimeOfLastSkyriderMonologue)
		.flag("emptyHelp", gfSkyriderEmptyHelpGiven)
		.num("hits", gubHelicopterHitsTaken)
		.flag("congrats", gfSkyriderSaidCongratsOnTakingSAM)
		.num("progress", gubPlayerProgressSkyriderLastCommentedOn)
		.raw("refuel", Numbers({fRefuelingSiteAvailable[0], fRefuelingSiteAvailable[1]}));
	if (iHelicopterVehicleId != -1)
	{
		VEHICLETYPE const& v = GetHelicopter();
		std::vector<long long> slots;
		for (SOLDIERTYPE const* p : v.pPassengers) slots.push_back(p ? p->ubID : -1);
		std::vector<long long> path;
		for (PathSt const* n = v.pMercPath; n; n = n->pNext) path.push_back(n->uiSectorId);
		j.raw("sector", StrategicSector(v.sSector)).flag("vehicleBetween", v.fBetweenSectors).raw("passengers", Numbers(slots)).raw("path", Numbers(path));
		if (GROUP const* g = GetGroup(v.ubMovementGroup)) j.raw("group", HeliGroup(*g));
	}
	return j.text();
}

std::string HeliSoldiers()
{
	std::vector<std::string> list;
	CFOR_EACH_IN_TEAM(s, OUR_TEAM)
	{
		UINT8 const role = s->uiStatusFlags & SOLDIER_DRIVER ? 1 : s->uiStatusFlags & SOLDIER_PASSENGER ? 2 : 0;
		list.push_back(Json{}
			.num("id", s->ubID)
			.num("assignment", s->bAssignment)
			.num("vehicleId", s->iVehicleId)
			.raw("sector", StrategicSector(s->sSector))
			.flag("betweenSectors", s->fBetweenSectors)
			.num("groupId", s->ubGroupID)
			.num("insertionCode", s->ubStrategicInsertionCode)
			.num("insertionData", s->usStrategicInsertionData)
			.num("role", role)
			.num("life", s->bLife)
			.flag("inSector", s->bInSector)
			.text());
	}
	return JsonArray(list);
}

std::string HeliSquads()
{
	std::vector<std::string> squads;
	for (int q = 0; q < NUMBER_OF_SQUADS; ++q)
	{
		std::vector<long long> members;
		for (SOLDIERTYPE const* m : Squad[q]) if (m) members.push_back(m->ubID);
		squads.push_back(Numbers(members));
	}
	return JsonArray(squads);
}

std::string HeliEvents()
{
	INT32 const heliGroup = iHelicopterVehicleId != -1 ? GetHelicopter().ubMovementGroup : -1;
	std::vector<std::string> events;
	for (STRATEGICEVENT const* e = gpEventList; e; e = e->next)
	{
		bool const heli = (e->ubCallbackID == EVENT_GROUP_ARRIVAL || e->ubCallbackID == EVENT_GROUP_ABOUT_TO_ARRIVE) && static_cast<INT32>(e->uiParam) == heliGroup;
		bool const hover = e->ubCallbackID == EVENT_HELICOPTER_HOVER_TOO_LONG || e->ubCallbackID == EVENT_HELICOPTER_HOVER_WAY_TOO_LONG;
		if (!heli && !hover && e->ubCallbackID != EVENT_MEANWHILE) continue;
		events.push_back(Numbers({e->uiTimeStamp, e->ubCallbackID, e->uiParam}));
	}
	return JsonArray(events);
}

void EmitHeli(Command const& c, std::string const& draws, Json extra = Json{})
{
	std::vector<long long> quotes(gOracleSkyriderQuotes.begin(), gOracleSkyriderQuotes.end());
	gOracleSkyriderQuotes.clear();
	std::vector<long long> noticed;
	for (UINT16 i = 0; i < 256; ++i) if (SectorInfo[i].uiFlags & SF_SKYRIDER_NOTICED_ENEMIES_HERE) noticed.push_back(i);
	std::vector<long long> sams;
	for (auto const* sam : GCM->getSamSites()) sams.push_back(IsSecretFoundAt(sam->sectorId));
	extra.str("probe", c.name)
		.num("line", c.line)
		.raw("args", DescribeArgs(c))
		.num("worldMinutes", GetWorldTotalMin())
		.raw("draws", draws)
		.raw("quotes", Numbers(quotes))
		.raw("heli", HeliState())
		.raw("skyrider", Numbers({gMercProfiles[SKYRIDER].iBalance, gMercProfiles[SKYRIDER].bLife}))
		.num("money", LaptopSaveInfo.iCurrentBalance)
		.raw("facts", Numbers({gubFact[FACT_SKYRIDER_CLOSE_TO_CHOPPER], gubFact[FACT_SKYRIDER_USED_IN_MAPSCREEN], gubFact[FACT_LOYALTY_LOW], gubFact[FACT_ESTONI_REFUELLING_POSSIBLE]}))
		.raw("noticed", Numbers(noticed))
		.raw("samsFound", Numbers(sams))
		.raw("soldiers", HeliSoldiers())
		.raw("squads", HeliSquads())
		.raw("events", HeliEvents());
	Emit(extra);
}

void HeliBegin()
{
	gOracleSkyriderSilent = true;
	fShowAircraftFlag = TRUE;
}

void DumpHeli(Command const& c)
{
	HeliBegin();
	EmitHeli(c, "[]");
}

std::pair<std::string, std::string> HeliPair(std::string const& part)
{
	auto const colon = part.find(':');
	if (colon == std::string::npos) throw std::runtime_error("expected key:value, got " + part);
	return {part.substr(0, colon), part.substr(colon + 1)};
}

void SetHeli(Command const& c)
{
	HeliBegin();
	if (Has(c, "money")) AddTransactionToPlayersBook(ANONYMOUS_DEPOSIT, 0, GetWorldTotalMin(), static_cast<INT32>(Required(c, "money")) - LaptopSaveInfo.iCurrentBalance);
	if (Has(c, "owed")) gMercProfiles[SKYRIDER].iBalance = -static_cast<INT32>(Required(c, "owed"));
	for (std::string const& part : SplitList(Text(c, "control", ""), ','))
	{
		auto const [sector, enemy] = HeliPair(part);
		StrategicMap[SGPSector::FromShortString(ST::string(sector)).AsStrategicIndex()].fEnemyControlled = enemy != "0";
	}
	for (std::string const& part : SplitList(Text(c, "sam", ""), ','))
	{
		std::vector<std::string> const f = SplitList(part, ':');
		if (f.size() != 3) throw std::runtime_error("sam entries look like <id>:<condition>:<enemy>");
		StrategicMapElement& e = StrategicMap[SGPSector(GCM->getSamSites()[std::stoi(f[0])]->sectorId).AsStrategicIndex()];
		e.bSAMCondition = static_cast<INT8>(std::stoi(f[1]));
		e.fEnemyControlled = f[2] != "0";
	}
	for (std::string const& part : SplitList(Text(c, "enemies", ""), ','))
	{
		auto const [sector, troops] = HeliPair(part);
		SectorInfo[SGPSector::FromShortString(ST::string(sector)).AsByte()].ubNumTroops = static_cast<UINT8>(std::stoi(troops));
	}
	for (std::string const& part : SplitList(Text(c, "fact", ""), ','))
	{
		auto const [id, value] = HeliPair(part);
		gubFact[std::stoi(id)] = static_cast<UINT8>(std::stoi(value));
	}
	for (std::string const& part : SplitList(Text(c, "loyalty", ""), ','))
	{
		auto const [town, rating] = HeliPair(part);
		gTownLoyalty[std::stoi(town)].ubRating = static_cast<UINT8>(std::stoi(rating));
		gTownLoyalty[std::stoi(town)].fStarted = TRUE;
	}
	if (Has(c, "talk")) guiHelicopterSkyriderTalkState = static_cast<UINT32>(Required(c, "talk"));
	if (Has(c, "lastmono")) guiTimeOfLastSkyriderMonologue = static_cast<UINT32>(Required(c, "lastmono"));
	if (Has(c, "congrats")) gfSkyriderSaidCongratsOnTakingSAM = Required(c, "congrats") != 0;
	if (Has(c, "emptyhelp")) gfSkyriderEmptyHelpGiven = Required(c, "emptyhelp") != 0;
	if (Has(c, "hits")) gubHelicopterHitsTaken = static_cast<UINT8>(Required(c, "hits"));
	if (Has(c, "progress")) gubPlayerProgressSkyriderLastCommentedOn = static_cast<UINT8>(Required(c, "progress"));
	if (Has(c, "cost")) iTotalAccumulatedCostByPlayer = static_cast<INT32>(Required(c, "cost"));
	if (Integer(c, "airspace", 0) != 0) UpdateAirspaceControl();
	EmitHeli(c, "[]");
}

void ProbeHeliSetUp(Command const& c)
{
	HeliBegin();
	SGPSector const sector = StrategicSectorArgument(c, "sector");
	std::string const draws = TracedSaiDraws([&] { SetUpHelicopterForPlayer(sector); });
	EmitHeli(c, draws);
}

void ProbeHeliBoard(Command const& c)
{
	HeliBegin();
	SOLDIERTYPE& s = GetMan(static_cast<SoldierID>(Required(c, "who")));
	VEHICLETYPE& v = GetHelicopter();
	bool const accessible = IsThisVehicleAccessibleToSoldier(s, v);
	bool const space = IsEnoughSpaceInVehicle(v);
	bool boarded = false;
	std::string const draws = TracedSaiDraws([&] { if (accessible && space) boarded = PutSoldierInVehicle(s, v); });
	EmitHeli(c, draws, Json{}.flag("accessible", accessible).flag("space", space).flag("boarded", boarded));
}

void ProbeHeliLeave(Command const& c)
{
	HeliBegin();
	SOLDIERTYPE& s = GetMan(static_cast<SoldierID>(Required(c, "who")));
	INT8 const squad = static_cast<INT8>(Integer(c, "squad", GetFirstEmptySquad()));
	std::string const draws = TracedSaiDraws([&] {
		bool const exiting = InHelicopter(s);
		if (s.bAssignment == VEHICLE) TakeSoldierOutOfVehicle(&s);
		RemoveCharacterFromSquads(&s);
		AddCharacterToSquad(&s, squad);
		if (exiting) SetSoldierExitHelicopterInsertionData(&s);
	});
	EmitHeli(c, draws, Json{}.num("squad", squad));
}

void ProbeHeliRoute(Command const& c)
{
	HeliBegin();
	SGPSector const to = StrategicSectorArgument(c, "to");
	bool allowed = false;
	std::string const draws = TracedSaiDraws([&] {
		allowed = OracleRequestGiveSkyriderNewDestination();
		fPlotForHelicopter = FALSE;
		if (!allowed) return;
		VEHICLETYPE& v = GetHelicopter();
		if (v.pMercPath) CancelPathForVehicle(v, FALSE);
		PlotPathForHelicopter(to);
		TakeOffHelicopter();
		RebuildWayPointsForGroupPath(v.pMercPath, *GetGroup(v.ubMovementGroup));
		if (iHelicopterVehicleId != -1 && GetLengthOfPath(GetHelicopter().pMercPath) > 0) OracleHandleNewDestConfirmation(to);
		fPlotForHelicopter = FALSE;
	});
	EmitHeli(c, draws, Json{}.flag("allowed", allowed));
}

void ProbeHeliCancel(Command const& c)
{
	HeliBegin();
	bool const canFly = CanHelicopterFly();
	std::string const draws = TracedSaiDraws([&] {
		VEHICLETYPE& v = GetHelicopter();
		if (canFly && v.pMercPath) CancelPathForVehicle(v, FALSE);
	});
	EmitHeli(c, draws, Json{}.flag("canFly", canFly));
}

void ProbeHeliWarp(Command const& c)
{
	HeliBegin();
	UINT32 const seconds = static_cast<UINT32>(Required(c, "minutes")) * 60;
	std::string const draws = TracedSaiDraws([&] { WarpGameTime(seconds, WARPTIME_PROCESS_EVENTS_NORMALLY); });
	EmitHeli(c, draws);
}

void ProbeHeliMonologue(Command const& c)
{
	HeliBegin();
	bool const available = IsHelicopterPilotAvailable();
	std::string const draws = TracedSaiDraws([&] { if (available) CheckAndHandleSkyriderMonologues(); });
	EmitHeli(c, draws, Json{}.flag("available", available));
}

void ProbeHeliPayDebt(Command const& c)
{
	HeliBegin();
	std::string const draws = TracedSaiDraws([] { PayOffSkyriderDebtIfAny(); });
	EmitHeli(c, draws);
}

void ProbeHeliReturn(Command const& c)
{
	HeliBegin();
	std::string const draws = TracedSaiDraws([] { OracleMakeHeliReturnToBase(); });
	EmitHeli(c, draws);
}
struct OracleDialogueEntry
{
	std::string kind;
	int a, b, c, d;
};

struct OracleFactEntry
{
	int fact, profile, value;
};

std::vector<OracleDialogueEntry>* gOracleDialogueTrace = nullptr;
std::vector<OracleFactEntry>* gOracleFactTrace = nullptr;
int gOracleFactDepth = 0;

std::map<std::string, Approach> const APPROACHES{
	{"friendly", APPROACH_FRIENDLY}, {"direct", APPROACH_DIRECT}, {"threaten", APPROACH_THREATEN}, {"recruit", APPROACH_RECRUIT},
	{"repeat", APPROACH_REPEAT}, {"initial", NPC_INITIAL_QUOTE}, {"whoareyou", NPC_WHOAREYOU}, {"trigger", TRIGGER_NPC},
	{"buysell", APPROACH_BUYSELL}, {"initiating", NPC_INITIATING_CONV}, {"givingitem", APPROACH_GIVINGITEM},
	{"declaration", APPROACH_DECLARATION_OF_HOSTILITY}, {"enemy", APPROACH_ENEMY_NPC_QUOTE}, {"notsafe", APPROACH_SECTOR_NOT_SAFE},
};

std::string DescribeRecord(NPCQuoteInfo const& q)
{
	std::vector<long long> const v{
		q.fFlags, q.sRequiredItem, q.usFactMustBeTrue, q.usFactMustBeFalse, q.ubQuest, q.ubFirstDay, q.ubLastDay,
		q.ubApproachRequired, q.ubOpinionRequired, q.ubQuoteNum, q.ubNumQuotes, q.ubStartQuest, q.ubEndQuest, q.ubTriggerNPC,
		q.ubTriggerNPCRec, q.usSetFactTrue, q.usGiftItem, q.usGoToGridno, q.sActionData,
	};
	std::string list = "[";
	for (size_t i = 0; i < v.size(); ++i) list += (i ? "," : "") + std::to_string(v[i]);
	return list + "]";
}

std::string DescribeRecords(NPCQuoteInfo const* q)
{
	std::vector<std::string> items;
	for (int i = 0; i < NUM_NPC_QUOTE_RECORDS; ++i) items.push_back(DescribeRecord(q[i]));
	return JsonArray(items);
}

std::string DescribeNpcProfile(UINT8 const id)
{
	MERCPROFILESTRUCT const& p = GetProfile(id);
	std::vector<long long> factors, values, mods;
	for (int k = 0; k < 4; ++k)
	{
		factors.push_back(p.usApproachFactor[k]);
		values.push_back(p.ubApproachVal[k]);
	}
	for (int r = 0; r < 3; ++r) for (int k = 0; k < 4; ++k) mods.push_back(p.ubApproachMod[r][k]);
	return Json{}
		.num("profile", id)
		.nums("approachFactor", factors)
		.nums("approachVal", values)
		.nums("approachMod", mods)
		.num("approached", p.bApproached)
		.num("lastDateSpokenTo", p.ubLastDateSpokenTo)
		.num("lastQuoteSaid", p.ubLastQuoteSaid)
		.num("lastQuoteSaidWasSpecial", p.bLastQuoteSaidWasSpecial)
		.num("friendlyOrDirect", p.bFriendlyOrDirectDefaultResponseUsedRecently)
		.num("recruit", p.bRecruitDefaultResponseUsedRecently)
		.num("threaten", p.bThreatenDefaultResponseUsedRecently)
		.num("quoteRecord", p.ubQuoteRecord)
		.num("quoteActionId", p.ubQuoteActionID)
		.num("npcData", p.bNPCData)
		.num("npcData2", p.bNPCData2)
		.num("miscFlags", p.ubMiscFlags)
		.num("miscFlags2", p.ubMiscFlags2)
		.num("miscFlags3", p.ubMiscFlags3)
		.num("balance", p.iBalance)
		.num("town", p.bTown)
		.num("townAttachment", p.bTownAttachment)
		.num("money", p.uiMoney)
		.nums("sector", {p.sSector.x, p.sSector.y, p.sSector.z})
		.text();
}

std::string DescribeDialogueTrace(std::vector<OracleDialogueEntry> const& trace)
{
	std::vector<std::string> items;
	for (auto const& e : trace) items.push_back(Json{}.str("kind", e.kind).nums("args", {e.a, e.b, e.c, e.d}).text());
	return JsonArray(items);
}

std::string DescribeFactTrace(std::vector<OracleFactEntry> const& trace)
{
	std::vector<std::string> items;
	for (auto const& e : trace) items.push_back("[" + std::to_string(e.fact) + "," + std::to_string(e.profile) + "," + std::to_string(e.value) + "]");
	return JsonArray(items);
}

UINT8 MercProfileArgument(Command const& c)
{
	if (!Has(c, "merc")) return NO_PROFILE;
	return GetMan(static_cast<SoldierID>(Required(c, "merc"))).ubProfile;
}

void DumpNpcRecords(Command const& c)
{
	std::vector<std::string> arrays;
	for (int id = 0; id < NUM_PROFILES; ++id)
	{
		if (Has(c, "profile") && Required(c, "profile") != id) continue;
		NPCQuoteInfo const* current = OracleQuoteArray(static_cast<UINT8>(id), false);
		NPCQuoteInfo const* backup = OracleQuoteArray(static_cast<UINT8>(id), true);
		if (!current && !backup) continue;
		arrays.push_back(Json{}
			.num("profile", id)
			.raw("records", current ? DescribeRecords(current) : "null")
			.raw("backup", backup ? DescribeRecords(backup) : "null")
			.text());
	}
	std::vector<std::string> civ;
	for (int i = 0; i < 20; ++i)
	{
		NPCQuoteInfo const* q = OracleCivQuoteArray(static_cast<UINT8>(i));
		civ.push_back(q ? DescribeRecords(q) : "null");
	}
	Emit(Json{}.str("probe", "npcrecords").num("line", c.line).num("only", Integer(c, "profile", -1)).raw("arrays", JsonArray(arrays))
		.raw("civilian", JsonArray(civ)));
}

void DumpNpcProfile(Command const& c)
{
	UINT8 const id = static_cast<UINT8>(Required(c, "profile"));
	Emit(Json{}.str("probe", "npcprofile").num("line", c.line).raw("profile", DescribeNpcProfile(id)));
}

void ProbeDesire(Command const& c)
{
	UINT8 const npc = static_cast<UINT8>(Required(c, "npc"));
	UINT8 const merc = MercProfileArgument(c);
	Approach const approach = Lookup(APPROACHES, c, "approach", "friendly");
	Emit(Json{}.str("probe", "desire").num("line", c.line).num("npc", npc).num("merc", merc).num("approach", approach)
		.num("desire", CalcDesireToTalk(npc, merc, approach)).num("threat", OracleCalcThreateningEffectiveness(merc)));
}

void ProbeConsider(Command const& c)
{
	UINT8 const npc = static_cast<UINT8>(Required(c, "npc"));
	UINT8 const merc = MercProfileArgument(c);
	Approach const approach = Lookup(APPROACHES, c, "approach", "friendly");
	UINT8 const record = static_cast<UINT8>(Integer(c, "record", 0));
	std::string const before = DescribeNpcProfile(npc);
	std::vector<OracleFactEntry> facts;
	gOracleFactTrace = &facts;
	INT32 index = 0;
	UINT8 const opinion = OracleNPCConsiderTalking(npc, merc, approach, record, &index);
	gOracleFactTrace = nullptr;
	Emit(Json{}.str("probe", "consider").num("line", c.line).num("npc", npc).num("merc", merc).num("approach", approach)
		.num("record", record).num("opinion", opinion).num("index", index).raw("facts", DescribeFactTrace(facts))
		.raw("before", before).raw("after", DescribeNpcProfile(npc)));
}

void ResetTalkProbe()
{
	EmptyDialogueQueue();
	gfInTalkPanel = FALSE;
	gTacticalStatus.uiFlags &= ~ENGAGED_IN_CONV;
	giNPCReferenceCount = 0;
}

void ProbeTalk(Command const& c)
{
	UINT8 const npc = static_cast<UINT8>(Required(c, "npc"));
	SOLDIERTYPE* const npcSoldier = FindSoldierByProfileID(npc);
	if (!npcSoldier) throw std::runtime_error("talk: the NPC has no soldier in the loaded sector");
	SOLDIERTYPE* const merc = Has(c, "merc") ? &GetMan(static_cast<SoldierID>(Required(c, "merc"))) : nullptr;
	UINT8 const mercProfile = merc ? merc->ubProfile : NO_PROFILE;
	Approach const approach = Lookup(APPROACHES, c, "approach", "friendly");
	UINT8 const record = static_cast<UINT8>(Integer(c, "record", 0));
	std::vector<UINT8> const factsBefore(gubFact, gubFact + NUM_FACTS);
	std::vector<UINT8> const questsBefore(gubQuest, gubQuest + MAX_QUESTS);
	std::string const before = DescribeNpcProfile(npc);
	ResetTalkProbe();
	gfInTalkPanel = Integer(c, "panel", 1) != 0;
	gTalkPanel.ubCharNum = npc;
	gpSrcSoldier = merc;
	gpDestSoldier = npcSoldier;
	gubSrcSoldierProfile = mercProfile;
	std::vector<OracleDialogueEntry> dialogue;
	std::vector<OracleFactEntry> facts;
	std::vector<OracleDraw> draws;
	gOracleDialogueTrace = &dialogue;
	gOracleFactTrace = &facts;
	OracleTraceRandom(&draws);
	ConverseFull(npc, mercProfile, approach, record, nullptr);
	OracleTraceRandom(nullptr);
	gOracleFactTrace = nullptr;
	gOracleDialogueTrace = nullptr;
	bool const engaged = (gTacticalStatus.uiFlags & ENGAGED_IN_CONV) != 0;
	INT32 const references = giNPCReferenceCount;
	std::vector<std::string> factChanges, questChanges;
	for (int f = 0; f < NUM_FACTS; ++f)
		if (factsBefore[f] != gubFact[f]) factChanges.push_back("[" + std::to_string(f) + "," + std::to_string(factsBefore[f]) + "," + std::to_string(gubFact[f]) + "]");
	for (int q = 0; q < MAX_QUESTS; ++q)
		if (questsBefore[q] != gubQuest[q]) questChanges.push_back("[" + std::to_string(q) + "," + std::to_string(questsBefore[q]) + "," + std::to_string(gubQuest[q]) + "]");
	NPCQuoteInfo const* const quotes = OracleQuoteArray(npc, false);
	std::vector<long long> flags;
	for (int i = 0; quotes && i < NUM_NPC_QUOTE_RECORDS; ++i) flags.push_back(quotes[i].fFlags);
	Emit(Json{}.str("probe", "talk").num("line", c.line).num("npc", npc).num("merc", merc ? merc->ubID : -1).num("approach", approach)
		.num("record", record).num("day", GetWorldDay()).raw("queue", DescribeDialogueTrace(dialogue)).raw("facts", DescribeFactTrace(facts))
		.raw("draws", DescribeDraws(draws)).raw("factChanges", JsonArray(factChanges)).raw("questChanges", JsonArray(questChanges))
		.nums("flags", flags).flag("engaged", engaged).num("references", references).raw("before", before)
		.raw("after", DescribeNpcProfile(npc)));
	ResetTalkProbe();
}

void ProbeQuestDecode(Command const& c)
{
	NPCQuoteInfo quotes[NUM_NPC_QUOTE_RECORDS]{};
	quotes[0].usFactMustBeTrue = FACT_NONE;
	quotes[0].usFactMustBeFalse = FACT_NONE;
	quotes[0].ubLastDay = 255;
	quotes[0].ubOpinionRequired = 255;
	long long const offset = reinterpret_cast<UINT8 const*>(gubFact) - reinterpret_cast<UINT8 const*>(gubQuest);
	UINT8 const saved = gubFact[70];
	std::vector<std::string> results;
	for (UINT8 const quest : {100, 200})
	{
		for (UINT8 const value : {0, 1, 2})
		{
			gubFact[70] = value;
			quotes[0].ubQuest = quest;
			BOOLEAN const ok = OracleNPCConsiderQuote(NO_PROFILE, NO_PROFILE, TRIGGER_NPC, 0, 0, quotes);
			results.push_back("[" + std::to_string(quest) + "," + std::to_string(value) + "," + std::to_string(ok ? 1 : 0) + "]");
		}
	}
	gubFact[70] = saved;
	Emit(Json{}.str("probe", "questdecode").num("line", c.line).num("offset", offset).raw("results", JsonArray(results)));
}

} // namespace

void OracleDialogueTrace(char const* kind, int a, int b, int c, int d)
{
	if (gOracleDialogueTrace) gOracleDialogueTrace->push_back({kind, a, b, c, d});
}

BOOLEAN OracleTracedCheckFact(Fact const fact, UINT8 const profile)
{
	++gOracleFactDepth;
	BOOLEAN const value = CheckFact(fact, profile);
	--gOracleFactDepth;
	if (gOracleFactTrace && gOracleFactDepth == 0) gOracleFactTrace->push_back({fact, profile, value ? 1 : 0});
	return value;
}

#include "Action_Items.h"
#include "Arms_Dealer_Init.h"
#include "Explosion_Control.h"
#include "Handle_Items.h"
#include "Interface_Items.h"
#include "Soldier.h"
#include "Soldier_Functions.h"
#include "World_Items.h"

UINT8 OracleNPCConsiderReceivingItemFromMerc(UINT8 npc, UINT8 merc, OBJECTTYPE const* o, INT32* index, INT32* record);

namespace {
struct OracleGiveHook
{
	std::string kind;
	int a, b, c;
};

bool gOracleGiveActive = false;
std::vector<OracleGiveHook>* gOracleGiveHooks = nullptr;
std::vector<long long>* gOracleMedicalCosts = nullptr;
}

UINT32 OracleTracedMedicalCost(UINT8 const npc)
{
	UINT32 const cost = CalcMedicalCost(npc);
	if (gOracleMedicalCosts) gOracleMedicalCosts->push_back(cost);
	return cost;
}

BOOLEAN OracleGiveConversation(SOLDIERTYPE* const dest, SOLDIERTYPE* const src, Approach const approach, UINT8 const record, OBJECTTYPE* const object)
{
	if (!gOracleGiveActive) return InitiateConversationFull(dest, src, approach, record, object);
	if (gOracleGiveHooks) gOracleGiveHooks->push_back({"conversation", dest->ubID, src ? src->ubID : -1, approach});
	gfInTalkPanel = TRUE;
	gTalkPanel.ubCharNum = dest->ubProfile;
	gpSrcSoldier = src;
	gpDestSoldier = dest;
	gubSrcSoldierProfile = src ? src->ubProfile : NO_PROFILE;
	ConverseFull(dest->ubProfile, gubSrcSoldierProfile, approach, record, object);
	gTacticalStatus.uiFlags |= ENGAGED_IN_CONV;
	return TRUE;
}

void OracleGiveShop(UINT8 const dealer)
{
	if (!gOracleGiveActive) return EnterShopKeeperInterfaceScreen(dealer);
	if (gOracleGiveHooks) gOracleGiveHooks->push_back({"shop", dealer, 0, 0});
}

void OracleGiveOffer(OBJECTTYPE* const object, INT8 const slot)
{
	if (!gOracleGiveActive) return AddItemToPlayersOfferAreaAfterShopKeeperOpen(object, slot);
	if (gOracleGiveHooks) gOracleGiveHooks->push_back({"offer", object->usItem, slot, 0});
}

namespace {
long long MoneyOf(OBJECTTYPE const& o)
{
	return o.usItem != NOTHING && GCM->getItem(o.usItem)->getItemClass() == IC_MONEY ? o.uiMoneyAmount : 0;
}

std::string DescribeGivenObject(OBJECTTYPE const& o)
{
	return "[" + std::to_string(o.usItem) + "," + std::to_string(o.ubNumberOfObjects) + "," + std::to_string(o.bStatus[0]) + "," +
		std::to_string(MoneyOf(o)) + "]";
}

std::string DescribeSoldierInventory(SOLDIERTYPE const& s)
{
	std::vector<std::string> slots;
	for (int k = 0; k < NUM_INV_SLOTS; ++k) slots.push_back(DescribeGivenObject(s.inv[k]));
	return JsonArray(slots);
}

std::string DescribeProfileInventory(UINT8 const id)
{
	MERCPROFILESTRUCT const& p = GetProfile(id);
	std::vector<long long> items, status, number;
	for (int k = 0; k < NUM_INV_SLOTS; ++k)
	{
		items.push_back(p.inv[k]);
		status.push_back(p.bInvStatus[k]);
		number.push_back(p.bInvNumber[k]);
	}
	return Json{}.nums("inv", items).nums("status", status).nums("number", number).num("money", p.uiMoney).text();
}

std::string DescribePool(INT16 const gridNo, UINT8 const level)
{
	std::vector<std::string> items;
	CFOR_EACH_WORLD_ITEM(wi)
	{
		if (wi.sGridNo != gridNo || wi.ubLevel != level) continue;
		items.push_back("[" + std::to_string(wi.bVisible) + "," + DescribeGivenObject(wi.o) + "]");
	}
	return JsonArray(items);
}

std::string ChangedBytes(std::vector<UINT8> const& before, UINT8 const* after, int count)
{
	std::vector<std::string> changes;
	for (int k = 0; k < count; ++k)
	{
		if (before[k] != after[k]) changes.push_back("[" + std::to_string(k) + "," + std::to_string(before[k]) + "," + std::to_string(after[k]) + "]");
	}
	return JsonArray(changes);
}

std::string DescribeGiveHooks(std::vector<OracleGiveHook> const& hooks)
{
	std::vector<std::string> items;
	for (auto const& h : hooks) items.push_back(Json{}.str("kind", h.kind).nums("args", {h.a, h.b, h.c}).text());
	return JsonArray(items);
}

std::string PairList(Command const& c, std::string const& key, UINT8* target)
{
	std::vector<std::string> list;
	for (std::string const& part : SplitList(Text(c, key, ""), ','))
	{
		auto const [id, value] = SplitPair(part);
		target[std::stoi(id)] = static_cast<UINT8>(value);
		list.push_back("[" + id + "," + std::to_string(value) + "]");
	}
	return JsonArray(list);
}

std::string ApplyGiveSetup(Command const& c, UINT8 const npc, UINT8 const mercProfile)
{
	Json setup;
	if (Has(c, "fact")) setup.raw("facts", PairList(c, "fact", gubFact));
	if (Has(c, "quest")) setup.raw("quests", PairList(c, "quest", gubQuest));
	if (Has(c, "balance"))
	{
		GetProfile(npc).iBalance = static_cast<INT32>(Required(c, "balance"));
		setup.num("balance", GetProfile(npc).iBalance);
	}
	if (Has(c, "npcdata"))
	{
		GetProfile(npc).bNPCData = static_cast<INT8>(Required(c, "npcdata"));
		setup.num("npcData", GetProfile(npc).bNPCData);
	}
	if (Has(c, "hospital"))
	{
		auto const [temp, refund] = SplitPair(Text(c, "hospital", ""));
		giHospitalTempBalance = std::stoi(temp);
		giHospitalRefund = static_cast<INT32>(refund);
		setup.nums("hospital", {giHospitalTempBalance, giHospitalRefund});
	}
	if (Has(c, "said"))
	{
		NPCHasUnusedRecordWithGivenApproach(npc, APPROACH_FRIENDLY);
		NPCQuoteInfo* const quotes = const_cast<NPCQuoteInfo*>(OracleQuoteArray(npc, false));
		if (!quotes) throw std::runtime_error("said: no record array");
		quotes[Required(c, "said")].fFlags |= QUOTE_FLAG_SAID;
		setup.num("said", Required(c, "said"));
	}
	if (Has(c, "mercsex"))
	{
		if (mercProfile == NO_PROFILE) throw std::runtime_error("mercsex: no merc");
		GetProfile(mercProfile).bSex = static_cast<UINT8>(Required(c, "mercsex"));
		setup.num("mercSex", GetProfile(mercProfile).bSex);
	}
	return setup.text();
}

OBJECTTYPE CreatedGiveObject(Command const& c)
{
	OBJECTTYPE o{};
	if (Has(c, "money"))
	{
		CreateMoney(static_cast<UINT32>(Required(c, "money")), &o);
		return o;
	}
	std::vector<std::string> const parts = SplitList(Text(c, "item", ""), ':');
	if (parts.size() != 3) throw std::runtime_error("item must be <name>:<status>:<count>");
	CreateItems(ItemArgument(parts[0]), static_cast<INT8>(std::stoi(parts[1])), static_cast<UINT8>(std::stoi(parts[2])), &o);
	return o;
}

struct GiveTraces
{
	std::vector<OracleDialogueEntry> dialogue;
	std::vector<OracleFactEntry> facts;
	std::vector<OracleDraw> draws;
	std::vector<long long> medical;
	std::vector<OracleGiveHook> hooks;
	std::vector<UINT8> factsBefore{gubFact, gubFact + NUM_FACTS};
	std::vector<UINT8> questsBefore{gubQuest, gubQuest + MAX_QUESTS};

	void start()
	{
		gOracleDialogueTrace = &dialogue;
		gOracleFactTrace = &facts;
		gOracleMedicalCosts = &medical;
		gOracleGiveHooks = &hooks;
		OracleTraceRandom(&draws);
	}

	void stop()
	{
		OracleTraceRandom(nullptr);
		gOracleGiveHooks = nullptr;
		gOracleMedicalCosts = nullptr;
		gOracleFactTrace = nullptr;
		gOracleDialogueTrace = nullptr;
	}

	Json& emit(Json& json) const
	{
		return json.raw("queue", DescribeDialogueTrace(dialogue))
			.raw("facts", DescribeFactTrace(facts))
			.raw("draws", DescribeDraws(draws))
			.nums("medical", medical)
			.raw("hooks", DescribeGiveHooks(hooks))
			.raw("factChanges", ChangedBytes(factsBefore, gubFact, NUM_FACTS))
			.raw("questChanges", ChangedBytes(questsBefore, gubQuest, MAX_QUESTS))
			.nums("hospital", {giHospitalTempBalance, giHospitalRefund});
	}
};

std::string TakeCursor()
{
	if (!gpItemPointer) return "null";
	std::string const cursor = DescribeGivenObject(*gpItemPointer);
	gpItemPointer = NULL;
	return cursor;
}

void ProbeReceive(Command const& c)
{
	UINT8 const npc = static_cast<UINT8>(Required(c, "npc"));
	SOLDIERTYPE* const merc = Has(c, "merc") ? &GetMan(static_cast<SoldierID>(Required(c, "merc"))) : nullptr;
	UINT8 const mercProfile = merc ? merc->ubProfile : NO_PROFILE;
	std::string const setup = ApplyGiveSetup(c, npc, mercProfile);
	OBJECTTYPE const o = CreatedGiveObject(c);
	UINT32 const costBefore = GetProfile(npc).uiTotalCostToDate;
	UINT32 const frankBefore = gArmsDealerStatus[ARMS_DEALER_FRANK].uiArmsDealersCash;
	ResetTalkProbe();
	GiveTraces traces;
	traces.start();
	INT32 index = 0;
	INT32 record = 0;
	UINT8 const opinion = OracleNPCConsiderReceivingItemFromMerc(npc, mercProfile, &o, &index, &record);
	traces.stop();
	Json json;
	json.str("probe", "receive").num("line", c.line).num("npc", npc).num("merc", merc ? merc->ubID : -1).raw("object", DescribeGivenObject(o))
		.raw("setup", setup).num("index", index).num("record", record).num("opinion", opinion);
	traces.emit(json)
		.num("totalCost", static_cast<long long>(GetProfile(npc).uiTotalCostToDate) - costBefore)
		.num("frankCash", static_cast<long long>(gArmsDealerStatus[ARMS_DEALER_FRANK].uiArmsDealersCash) - frankBefore)
		.raw("after", DescribeNpcProfile(npc));
	Emit(json);
	ResetTalkProbe();
}

OBJECTTYPE PickedGiveObject(Command const& c, SOLDIERTYPE* const giver, INT8* const slot)
{
	OBJECTTYPE o{};
	if (Has(c, "money"))
	{
		UINT32 const amount = static_cast<UINT32>(Required(c, "money"));
		INT8 pocket = static_cast<INT8>(Integer(c, "pocket", -1));
		for (INT8 k = 0; pocket < 0 && k < NUM_INV_SLOTS; ++k)
		{
			if (giver->inv[k].usItem == MONEY && giver->inv[k].uiMoneyAmount >= amount) pocket = k;
		}
		if (pocket < 0 || giver->inv[pocket].usItem != MONEY || giver->inv[pocket].uiMoneyAmount < amount) throw std::runtime_error("no pocket with that much money");
		giver->inv[pocket].uiMoneyAmount -= amount;
		if (giver->inv[pocket].uiMoneyAmount == 0) giver->inv[pocket] = OBJECTTYPE{};
		CreateMoney(amount, &o);
		*slot = NO_SLOT;
		return o;
	}
	*slot = static_cast<INT8>(Required(c, "slot"));
	OBJECTTYPE cursor{};
	if (Integer(c, "count", 0) == 1) GetObjFrom(&giver->inv[*slot], 0, &cursor);
	else RemoveObjectFromSlot(giver, *slot, &cursor);
	o = cursor;
	PlaceObject(giver, *slot, &cursor);
	return o;
}

void ProbeGive(Command const& c)
{
	SOLDIERTYPE* const giver = &GetMan(static_cast<SoldierID>(Required(c, "who")));
	SOLDIERTYPE* const target = Has(c, "tonpc") ? FindSoldierByProfileID(static_cast<UINT8>(Required(c, "tonpc"))) : &GetMan(static_cast<SoldierID>(Required(c, "to")));
	if (!target) throw std::runtime_error("give: no such target");
	std::string const setup = ApplyGiveSetup(c, target->ubProfile, giver->ubProfile);
	std::vector<long long> cash;
	if (Has(c, "cash"))
	{
		auto const [pocket, amount] = SplitPair(Text(c, "cash", ""));
		CreateMoney(static_cast<UINT32>(amount), &giver->inv[std::stoi(pocket)]);
		cash = {std::stoi(pocket), amount};
	}
	INT8 slot = NO_SLOT;
	OBJECTTYPE const o = PickedGiveObject(c, giver, &slot);
	giver->bPendingActionData5 = slot;
	giver->sPendingActionData2 = target->sGridNo;
	giver->uiPendingActionData4 = target->ubID;
	SetTempObject(giver, o);
	INT16 const apBefore = giver->bActionPoints;
	ResetTalkProbe();
	GiveTraces traces;
	traces.start();
	gOracleGiveActive = true;
	SoldierGiveItemFromAnimation(giver);
	if (giver->ubProfile != NO_PROFILE && MercProfile(giver->ubProfile).isNPC()) TriggerNPCWithGivenApproach(giver->ubProfile, APPROACH_DONE_GIVING_ITEM);
	gOracleGiveActive = false;
	traces.stop();
	bool const engaged = (gTacticalStatus.uiFlags & ENGAGED_IN_CONV) != 0;
	NPCQuoteInfo const* const quotes = target->ubProfile != NO_PROFILE ? OracleQuoteArray(target->ubProfile, false) : nullptr;
	std::vector<long long> flags;
	for (int i = 0; quotes && i < NUM_NPC_QUOTE_RECORDS; ++i) flags.push_back(quotes[i].fFlags);
	Json json;
	json.str("probe", "give").num("line", c.line).num("who", giver->ubID).num("to", target->ubID).num("slot", slot)
		.raw("object", DescribeGivenObject(o)).raw("setup", setup).nums("cash", cash).num("day", GetWorldDay());
	traces.emit(json)
		.nums("flags", flags)
		.flag("engaged", engaged)
		.num("references", giNPCReferenceCount)
		.num("ap", apBefore - giver->bActionPoints)
		.flag("giverEngaged", (giver->uiStatusFlags & SOLDIER_ENGAGEDINACTION) != 0)
		.flag("targetEngaged", (target->uiStatusFlags & SOLDIER_ENGAGEDINACTION) != 0)
		.raw("giverInv", DescribeSoldierInventory(*giver))
		.raw("targetInv", DescribeSoldierInventory(*target))
		.raw("giverPool", DescribePool(giver->sGridNo, giver->bLevel))
		.raw("cursor", TakeCursor())
		.raw("targetProfile", target->ubProfile != NO_PROFILE ? DescribeNpcProfile(target->ubProfile) : "null")
		.raw("targetProfileInv", target->ubProfile != NO_PROFILE ? DescribeProfileInventory(target->ubProfile) : "null");
	Emit(json);
	giver->uiStatusFlags &= ~SOLDIER_ENGAGEDINACTION;
	target->uiStatusFlags &= ~SOLDIER_ENGAGEDINACTION;
	ResetTalkProbe();
}

void ProbeNpcGive(Command const& c)
{
	UINT8 const npc = static_cast<UINT8>(Required(c, "npc"));
	SOLDIERTYPE* const npcSoldier = FindSoldierByProfileID(npc);
	if (!npcSoldier) throw std::runtime_error("npcgive: the NPC has no soldier in the loaded sector");
	SOLDIERTYPE* const merc = Has(c, "merc") ? &GetMan(static_cast<SoldierID>(Required(c, "merc"))) : nullptr;
	INT8 const slot = static_cast<INT8>(Required(c, "slot"));
	if (Has(c, "item")) CreateItems(ItemArgument(Text(c, "item", "")), 100, 1, &npcSoldier->inv[slot]);
	ResetTalkProbe();
	gTalkPanel.ubCharNum = npc;
	gpSrcSoldier = merc;
	gpDestSoldier = npcSoldier;
	gubSrcSoldierProfile = merc ? merc->ubProfile : NO_PROFILE;
	GiveTraces traces;
	traces.start();
	HandleNPCItemGiven(npc, &npcSoldier->inv[slot], slot);
	traces.stop();
	bool const pending = npcSoldier->ubPendingAction == MERC_GIVEITEM || npcSoldier->pTempObject != nullptr;
	Json json;
	json.str("probe", "npcgive").num("line", c.line).num("npc", npc).num("merc", merc ? merc->ubID : -1).num("slot", slot);
	traces.emit(json)
		.flag("panel", gfInTalkPanel != FALSE)
		.flag("pending", pending)
		.nums("pendingData", {npcSoldier->bPendingActionData5, npcSoldier->sPendingActionData2, npcSoldier->bPendingActionData3,
			static_cast<long long>(npcSoldier->uiPendingActionData4)})
		.raw("temp", npcSoldier->pTempObject ? DescribeGivenObject(*npcSoldier->pTempObject) : "null")
		.raw("npcInv", DescribeSoldierInventory(*npcSoldier))
		.raw("npcPool", DescribePool(npcSoldier->sGridNo, 0));
	Emit(json);
	if (pending)
	{
		EVENT_StopMerc(npcSoldier);
		ClearTempObject(npcSoldier);
		Soldier{npcSoldier}.removePendingAction();
	}
	npcSoldier->uiStatusFlags &= ~SOLDIER_ENGAGEDINACTION;
	if (merc) merc->uiStatusFlags &= ~SOLDIER_ENGAGEDINACTION;
	ResetTalkProbe();
}

INT32 AddProbeBomb(UINT16 const item, INT16 const gridNo, UINT8 const level, INT8 const detonator, INT8 const frequency, UINT8 const owner, UINT8 const action)
{
	OBJECTTYPE o{};
	CreateItem(item, 100, &o);
	o.bDetonatorType = detonator;
	o.bFrequency = frequency;
	o.ubBombOwner = owner;
	o.bActionValue = action;
	if (item == ACTION_ITEM) o.fFlags |= OBJECT_ARMED_BOMB;
	return AddItemToPool(gridNo, &o, BURIED, level, WORLD_ITEM_ARMED_BOMB, 0);
}

void ProbeActionItem(Command const& c)
{
	SOLDIERTYPE* const merc = &GetMan(static_cast<SoldierID>(Required(c, "who")));
	UINT8 const action = static_cast<UINT8>(Required(c, "action"));
	INT8 const detonator = static_cast<INT8>(Integer(c, "det", BOMB_PRESSURE));
	INT8 const frequency = static_cast<INT8>(Integer(c, "freq", 0));
	UINT8 const owner = static_cast<UINT8>(Integer(c, "owner", 1));
	bool const viaSwitch = Integer(c, "switch", 0) != 0;
	INT16 const at = static_cast<INT16>(Integer(c, "at", merc->sGridNo));
	std::vector<INT32> added;
	if (viaSwitch)
	{
		added.push_back(AddProbeBomb(SWITCH, merc->sGridNo, merc->bLevel, BOMB_PRESSURE, frequency, owner, 0));
		added.push_back(AddProbeBomb(ACTION_ITEM, at, merc->bLevel, BOMB_REMOTE, frequency, owner, action));
	}
	else
	{
		added.push_back(AddProbeBomb(ACTION_ITEM, at, merc->bLevel, detonator, frequency, owner, action));
	}
	std::vector<long long> const groupsBefore(gTacticalStatus.fCivGroupHostile, gTacticalStatus.fCivGroupHostile + NUM_CIV_GROUPS);
	ResetTalkProbe();
	GiveTraces traces;
	traces.start();
	SetOffBombsInGridNo(merc, merc->sGridNo, FALSE, merc->bLevel);
	long long const queued = gubElementsOnExplosionQueue;
	bool const disallowBefore = (gTacticalStatus.uiFlags & DISALLOW_SIGHT) != 0;
	HandleExplosionQueue();
	traces.stop();
	std::vector<long long> const groups(gTacticalStatus.fCivGroupHostile, gTacticalStatus.fCivGroupHostile + NUM_CIV_GROUPS);
	std::vector<std::string> civs;
	FOR_EACH_IN_TEAM(s, CIV_TEAM)
	{
		civs.push_back("[" + std::to_string(s->ubID) + "," + std::to_string(s->bNeutral ? 1 : 0) + "," + std::to_string(static_cast<int>(s->bSide)) + "]");
	}
	Json json;
	json.str("probe", "actionitem").num("line", c.line).num("who", merc->ubID).num("action", action).num("det", detonator).num("freq", frequency)
		.num("owner", owner).flag("viaSwitch", viaSwitch).num("at", at).num("queued", queued).flag("disallowBefore", disallowBefore)
		.flag("disallowAfter", (gTacticalStatus.uiFlags & DISALLOW_SIGHT) != 0).flag("active", gfExplosionQueueActive != FALSE)
		.nums("groupsBefore", groupsBefore).nums("groups", groups).flag("inCombat", (gTacticalStatus.uiFlags & INCOMBAT) != 0)
		.num("team", gTacticalStatus.ubCurrentTeam).raw("civs", JsonArray(civs)).num("gridNo", merc->sGridNo);
	traces.emit(json);
	Emit(json);
	for (INT32 const idx : added) RemoveItemFromPool(GetWorldItem(idx));
	ResetTalkProbe();
}
}

namespace {
std::vector<long long> NarrativeProfileIds(Command const& c)
{
	std::vector<long long> ids;
	if (Has(c, "ids"))
	{
		for (std::string const& v : SplitList(Text(c, "ids", ""), ',')) ids.push_back(std::stoll(v));
		return ids;
	}
	for (ProfileID id = 0; id < NUM_PROFILES; ++id)
	{
		if (MercProfile(id).isNPCorRPC() || MercProfile(id).isVehicle()) ids.push_back(id);
	}
	return ids;
}

std::string DescribeNarrativeProfile(ProfileID const pid)
{
	MERCPROFILESTRUCT const& p = GetProfile(pid);
	std::vector<long long> inventory, counts;
	for (UINT16 const item : p.inv) inventory.push_back(item);
	for (UINT8 const v : p.bInvNumber) counts.push_back(v);
	return Json{}
		.num("id", pid)
		.raw("sector", Numbers({p.sSector.x, p.sSector.y, p.sSector.z}))
		.raw("flags", Numbers({p.ubMiscFlags, p.ubMiscFlags2, p.ubMiscFlags3}))
		.raw("npcData", Numbers({p.bNPCData, p.bNPCData2}))
		.num("money", p.uiMoney)
		.num("balance", p.iBalance)
		.num("life", p.bLife)
		.num("lifeMax", p.bLifeMax)
		.num("status", p.bMercStatus)
		.num("town", p.bTown)
		.num("spokenTo", p.ubLastDateSpokenTo)
		.raw("insertion", Numbers({p.fUseProfileInsertionInfo, p.ubStrategicInsertionCode, p.usStrategicInsertionData}))
		.raw("quote", Numbers({p.ubQuoteRecord, p.ubQuoteActionID}))
		.raw("inventory", Numbers(inventory))
		.raw("invCount", Numbers(counts))
		.text();
}

std::string DescribeNarrativeProfiles(std::vector<long long> const& ids)
{
	std::vector<std::string> out;
	for (long long const id : ids) out.push_back(DescribeNarrativeProfile(static_cast<ProfileID>(id)));
	return JsonArray(out);
}

std::string DescribeNarrativeState()
{
	std::vector<long long> facts(std::begin(gubFact), std::end(gubFact));
	std::vector<long long> quests(std::begin(gubQuest), std::end(gubQuest));
	std::vector<long long> fought;
	for (BOOLEAN const f : gfBoxerFought) fought.push_back(f);
	return Json{}
		.nums("facts", facts)
		.nums("quests", quests)
		.raw("boxing", Json{}.num("won", gubBoxingMatchesWon).num("rests", gubBoxersRests).flag("resting", gfBoxersResting).nums("fought", fought).text())
		.num("terrorists", gubNumTerrorists)
		.num("balance", LaptopSaveInfo.iCurrentBalance)
		.num("worldMinutes", GetWorldTotalMin())
		.raw("worldSector", Numbers({gWorldSector.x, gWorldSector.y, gWorldSector.z}))
		.text();
}

std::vector<std::vector<long long>> ReadHistoryRecords()
{
	std::vector<std::vector<long long>> records;
	AutoSGPFile f(GCM->tempFiles()->openForReading(HISTORY_DATA_FILE));
	UINT const count = f->size() / 12;
	for (UINT i = 0; i < count; ++i)
	{
		UINT8 code;
		UINT8 second;
		UINT32 date;
		INT16 x;
		INT16 y;
		INT8 z;
		f->read(&code, sizeof(code));
		f->read(&second, sizeof(second));
		f->read(&date, sizeof(date));
		f->read(&x, sizeof(x));
		f->read(&y, sizeof(y));
		f->read(&z, sizeof(z));
		f->seek(1, FILE_SEEK_FROM_CURRENT);
		records.push_back({code, second, static_cast<long long>(date), x, y, z});
	}
	return records;
}

std::string DescribeHistoryTail(size_t from)
{
	std::vector<std::string> out;
	std::vector<std::vector<long long>> const records = ReadHistoryRecords();
	for (size_t i = from; i < records.size(); ++i) out.push_back(Numbers(records[i]));
	return JsonArray(out);
}

void EmitNarrative(Command const& c, std::string const& draws, std::string const& result, std::vector<long long> const& profiles)
{
	Emit(Json{}
		.str("probe", c.name)
		.num("line", c.line)
		.raw("args", DescribeArgs(c))
		.raw("draws", draws.empty() ? "[]" : draws)
		.raw("result", result.empty() ? "null" : result)
		.raw("state", DescribeNarrativeState())
		.raw("profiles", DescribeNarrativeProfiles(profiles)));
}

void DumpNarrative(Command const& c)
{
	EmitNarrative(c, "", "", NarrativeProfileIds(c));
}

void SetQuestState(Command const& c)
{
	gubQuest[Required(c, "id")] = static_cast<UINT8>(Integer(c, "status", QUESTINPROGRESS));
	EmitNarrative(c, "", "", {});
}

void SetNarrativeProfile(Command const& c)
{
	MERCPROFILESTRUCT& p = GetProfile(static_cast<ProfileID>(Required(c, "id")));
	if (Has(c, "sector")) p.sSector = StrategicSectorArgument(c, "sector");
	if (Has(c, "z")) p.sSector.z = static_cast<INT8>(Integer(c, "z", 0));
	if (Has(c, "nowhere")) p.sSector = SGPSector();
	if (Has(c, "npcdata")) p.bNPCData = static_cast<INT8>(Integer(c, "npcdata", 0));
	if (Has(c, "npcdata2")) p.bNPCData2 = static_cast<INT8>(Integer(c, "npcdata2", 0));
	if (Has(c, "flags")) p.ubMiscFlags = static_cast<UINT8>(Integer(c, "flags", 0));
	if (Has(c, "flags2")) p.ubMiscFlags2 = static_cast<UINT8>(Integer(c, "flags2", 0));
	if (Has(c, "flags3")) p.ubMiscFlags3 = static_cast<UINT8>(Integer(c, "flags3", 0));
	if (Has(c, "money")) p.uiMoney = static_cast<UINT32>(Integer(c, "money", 0));
	if (Has(c, "balance")) p.iBalance = static_cast<INT32>(Integer(c, "balance", 0));
	if (Has(c, "life")) p.bLife = static_cast<INT8>(Integer(c, "life", 0));
	if (Has(c, "spokento")) p.ubLastDateSpokenTo = static_cast<UINT8>(Integer(c, "spokento", 0));
	if (Has(c, "insertion")) p.fUseProfileInsertionInfo = Integer(c, "insertion", 0) != 0;
	if (Has(c, "code")) p.ubStrategicInsertionCode = static_cast<UINT8>(Integer(c, "code", 0));
	if (Has(c, "data")) p.usStrategicInsertionData = static_cast<UINT16>(Integer(c, "data", 0));
	EmitNarrative(c, "", "", {static_cast<long long>(Required(c, "id"))});
}

SOLDIERTYPE* NarrativeSoldierArgument(Command const& c, std::string const& key)
{
	if (!Has(c, key)) return nullptr;
	long long const id = Integer(c, key, -1);
	if (id < 0) return nullptr;
	SOLDIERTYPE& s = GetMan(static_cast<UINT>(id));
	if (!s.bActive) throw std::runtime_error("no active soldier " + std::to_string(id));
	return &s;
}

void ProbeCheckFact(Command const& c)
{
	ProfileID const profile = static_cast<ProfileID>(Integer(c, "profile", 0));
	if (Has(c, "src") || Has(c, "dest"))
	{
		gpSrcSoldier = NarrativeSoldierArgument(c, "src");
		gpDestSoldier = NarrativeSoldierArgument(c, "dest");
		if (gpSrcSoldier) gubSrcSoldierProfile = gpSrcSoldier->ubProfile;
	}
	if (Has(c, "srcprofile")) gubSrcSoldierProfile = static_cast<UINT8>(Integer(c, "srcprofile", 0));
	std::vector<long long> before(std::begin(gubFact), std::end(gubFact));
	std::vector<long long> results;
	if (Has(c, "id"))
	{
		results.push_back(CheckFact(static_cast<Fact>(Required(c, "id")), profile));
	}
	else
	{
		for (UINT16 id = 0; id < NUM_FACTS; ++id) results.push_back(CheckFact(static_cast<Fact>(id), profile));
	}
	EmitNarrative(c, "", Json{}.nums("before", before).nums("results", results).num("srcProfile", gubSrcSoldierProfile).text(), {});
}

void ProbeQuest(Command const& c)
{
	std::string const action = Text(c, "action", "start");
	UINT8 const quest = static_cast<UINT8>(Required(c, "id"));
	SGPSector const sector = Has(c, "sector") ? StrategicSectorArgument(c, "sector") : SGPSector(-1, -1);
	size_t const before = ReadHistoryRecords().size();
	if (action == "start") StartQuest(quest, sector);
	else if (action == "end") EndQuest(quest, sector);
	else if (action == "istart") InternalStartQuest(quest, sector, FALSE);
	else if (action == "iend") InternalEndQuest(quest, sector, FALSE);
	else throw std::runtime_error("unknown quest action " + action);
	EmitNarrative(c, "", Json{}.raw("history", DescribeHistoryTail(before)).text(), {MADAME});
}

void ProbeEarlyMorning(Command const& c)
{
	std::string const draws = TracedSaiDraws([] { HandleEarlyMorningEvents(); });
	EmitNarrative(c, draws, "", NarrativeProfileIds(c));
}

void ProbeHourlyNpc(Command const& c)
{
	UINT32 const hour = static_cast<UINT32>(Required(c, "hour"));
	guiDay = GetWorldDay();
	guiHour = hour;
	guiMin = 0;
	guiGameClock = guiDay * NUM_SEC_IN_DAY + hour * NUM_SEC_IN_HOUR;
	std::string const draws = TracedSaiDraws([] {
		OracleHourlyQuestUpdate();
		OracleHourlyCheckIfSlayAloneSoHeCanLeave();
		PayOffSkyriderDebtIfAny();
	});
	EmitNarrative(c, draws, "", {SKYRIDER, SLAY});
}

void ProbeQuestEntry(Command const& c)
{
	SGPSector sector = StrategicSectorArgument(c, "sector");
	sector.z = static_cast<INT8>(Integer(c, "z", 0));
	size_t const before = ReadHistoryRecords().size();
	std::string const draws = TracedSaiDraws([&sector] { HandleQuestCodeOnSectorEntry(sector); });
	EmitNarrative(c, draws, Json{}.raw("history", DescribeHistoryTail(before)).text(), NarrativeProfileIds(c));
}

void ProbeQuestExit(Command const& c)
{
	SGPSector sector = StrategicSectorArgument(c, "sector");
	sector.z = static_cast<INT8>(Integer(c, "z", 0));
	std::string const draws = TracedSaiDraws([&sector] { OracleHandleQuestCodeOnSectorExit(sector); });
	EmitNarrative(c, draws, "", NarrativeProfileIds(c));
}

void ProbeEnterSector(Command const& c)
{
	SGPSector sector = StrategicSectorArgument(c, "sector");
	sector.z = static_cast<INT8>(Integer(c, "z", 0));
	TracedSaiDraws([&sector] { SetCurrentWorldSector(sector); });
	std::vector<std::string> soldiers;
	FOR_EACH_SOLDIER(s)
	{
		if (s->ubProfile == NO_PROFILE || s->bTeam == OUR_TEAM) continue;
		soldiers.push_back(Json{}.num("id", s->ubID).num("profile", s->ubProfile).num("team", s->bTeam).num("gridNo", s->sGridNo).num("life", s->bLife).text());
	}
	EmitNarrative(c, "", Json{}.raw("soldiers", JsonArray(soldiers)).text(), NarrativeProfileIds(c));
}


std::vector<long long> ActionProfileIds(Command const& c, std::initializer_list<long long> extra)
{
	std::vector<long long> ids;
	if (Has(c, "ids"))
	{
		for (std::string const& v : SplitList(Text(c, "ids", ""), ',')) ids.push_back(std::stoll(v));
	}
	for (long long const id : extra)
	{
		if (id >= 0 && id < NUM_PROFILES && std::find(ids.begin(), ids.end(), id) == ids.end()) ids.push_back(id);
	}
	return ids;
}

std::string DescribeActionSoldier(SOLDIERTYPE const& s)
{
	return Numbers({s.ubID, s.ubProfile, s.bTeam, s.bNeutral, s.bLife, s.bBleeding, s.ubQuoteRecord, s.ubQuoteActionID, s.bOrders,
		s.fUIMovementFast, s.ubBodyType, s.bAction, s.bAssignment, s.bHospitalPriceModifier, s.sAbsoluteFinalDestination, s.ubCivilianGroup});
}

std::string DescribeActionSoldiers(Command const& c, UINT8 npc)
{
	std::vector<std::string> out;
	bool const all = Text(c, "soldiers", "") == "all";
	FOR_EACH_SOLDIER(s)
	{
		if (!s->bInSector) continue;
		if (s->ubProfile != npc && s->bTeam != OUR_TEAM && !all) continue;
		out.push_back(DescribeActionSoldier(*s));
	}
	return JsonArray(out);
}

struct ActionSnapshot
{
	std::vector<UINT8> facts;
	std::vector<UINT8> quests;
	std::vector<STRATEGICEVENT const*> events;
	size_t history;
	size_t mails;
};

ActionSnapshot TakeActionSnapshot()
{
	ActionSnapshot s;
	s.facts.assign(gubFact, gubFact + NUM_FACTS);
	s.quests.assign(gubQuest, gubQuest + MAX_QUESTS);
	for (STRATEGICEVENT const* e = gpEventList; e; e = e->next) s.events.push_back(e);
	s.history = ReadHistoryRecords().size();
	s.mails = 0;
	for (Email const* m = pEmailList; m; m = m->Next) ++s.mails;
	return s;
}

std::string DescribeChanges(std::vector<UINT8> const& before, UINT8 const* after, size_t n)
{
	std::vector<std::string> out;
	for (size_t i = 0; i < n; ++i)
		if (before[i] != after[i]) out.push_back(Numbers({static_cast<long long>(i), before[i], after[i]}));
	return JsonArray(out);
}

std::string DescribeNewEvents(ActionSnapshot const& before)
{
	std::vector<std::string> out;
	for (STRATEGICEVENT const* e = gpEventList; e; e = e->next)
	{
		if (std::find(before.events.begin(), before.events.end(), e) != before.events.end()) continue;
		out.push_back(Numbers({e->uiTimeStamp, e->ubCallbackID, e->uiParam}));
	}
	return JsonArray(out);
}

std::string DescribeNewMails(ActionSnapshot const& before)
{
	std::vector<std::string> out;
	size_t i = 0;
	for (Email const* m = pEmailList; m; m = m->Next, ++i)
		if (i >= before.mails) out.push_back(Numbers({m->usOffset, m->usLength, m->ubSender, m->iDate}));
	return JsonArray(out);
}

std::string DescribeWorldMoney()
{
	long long total = 0, piles = 0;
	for (WORLDITEM const& w : gWorldItems)
	{
		if (!w.fExists || w.o.usItem != MONEY) continue;
		total += w.o.uiMoneyAmount;
		++piles;
	}
	return Numbers({total, piles});
}

std::string DescribeDeliveryPool()
{
	auto const dest = GCM->getPrimaryShippingDestination();
	std::vector<std::string> items;
	if (gWorldSector != dest->deliverySector) return "[]";
	for (WORLDITEM const& w : gWorldItems)
	{
		if (!w.fExists) continue;
		if (w.sGridNo != dest->deliverySectorGridNo && w.sGridNo != 1 && w.sGridNo != 2) continue;
		items.push_back(Numbers({w.sGridNo, w.o.usItem, w.o.ubNumberOfObjects, w.o.bStatus[0], w.bVisible, w.ubLevel}));
	}
	return JsonArray(items);
}

UINT8 HospitalSupplyCount()
{
	UINT8 count = 0;
	for (WORLDITEM const& wi : gWorldItems)
	{
		if (!wi.fExists || wi.o.usItem != OWNERSHIP || wi.o.ubOwnerCivGroup != DOCTORS_CIV_GROUP) continue;
		for (ITEM_POOL const* pool = GetItemPool(wi.sGridNo, 0); pool; pool = pool->pNext)
		{
			OBJECTTYPE const& o = GetWorldItem(pool->iItemIndex).o;
			if (o.bStatus[0] > 60 && (o.usItem == FIRSTAIDKIT || o.usItem == MEDICKIT || o.usItem == REGEN_BOOSTER || o.usItem == ADRENALINE_BOOSTER))
				++count;
		}
	}
	return count;
}

void SetupActionContext(Command const& c, UINT8 npc)
{
	ResetTalkProbe();
	OracleResetDialogueMessageBox();
	gfInTalkPanel = Integer(c, "panel", 0) != 0;
	gTalkPanel.ubCharNum = npc;
	SOLDIERTYPE* const npcSoldier = npc == NO_PROFILE ? nullptr : FindSoldierByProfileID(npc);
	gpDestSoldier = Has(c, "dest") ? NarrativeSoldierArgument(c, "dest") : npcSoldier;
	gpSrcSoldier = NarrativeSoldierArgument(c, "src");
	gubSrcSoldierProfile = gpSrcSoldier ? gpSrcSoldier->ubProfile : NO_PROFILE;
}

template<typename Run>
void RunActionProbe(Command const& c, UINT8 npc, std::string const& extra, Run&& run)
{
	ActionSnapshot const before = TakeActionSnapshot();
	std::vector<OracleDialogueEntry> dialogue;
	std::vector<OracleFactEntry> facts;
	std::vector<OracleDraw> draws;
	gOracleSkipDialogueBoxes = true;
	gOracleDialogueTrace = &dialogue;
	gOracleFactTrace = &facts;
	OracleTraceRandom(&draws);
	run();
	OracleTraceRandom(nullptr);
	gOracleFactTrace = nullptr;
	gOracleDialogueTrace = nullptr;
	gOracleSkipDialogueBoxes = false;
	std::vector<long long> const hospital{gbHospitalPriceModifier, giHospitalTempBalance, giHospitalRefund, gubCambriaMedicalObjects};
	Emit(Json{}
		.str("probe", c.name)
		.num("line", c.line)
		.raw("args", DescribeArgs(c))
		.num("npc", npc)
		.raw("queue", DescribeDialogueTrace(dialogue))
		.raw("facts", DescribeFactTrace(facts))
		.raw("draws", DescribeDraws(draws))
		.raw("factChanges", DescribeChanges(before.facts, gubFact, NUM_FACTS))
		.raw("questChanges", DescribeChanges(before.quests, gubQuest, MAX_QUESTS))
		.raw("events", DescribeNewEvents(before))
		.raw("history", DescribeHistoryTail(before.history))
		.raw("mails", DescribeNewMails(before))
		.nums("hospital", hospital)
		.raw("box", Numbers({OracleDialogueMessageBoxType(), OracleLiePromptRecord()}))
		.raw("combat", Numbers({(gTacticalStatus.uiFlags & INCOMBAT) != 0, gTacticalStatus.fEnemyInSector}))
		.raw("soldiers", DescribeActionSoldiers(c, npc))
		.raw("profiles", DescribeNarrativeProfiles(ActionProfileIds(c, {npc})))
		.raw("extra", extra.empty() ? "null" : extra)
		.raw("pool", DescribeDeliveryPool())
		.raw("money", DescribeWorldMoney())
		.num("worldMinutes", GetWorldTotalMin()));
	ResetTalkProbe();
}

void ProbeNpcAction(Command const& c)
{
	UINT8 const npc = static_cast<UINT8>(Required(c, "npc"));
	UINT16 const code = static_cast<UINT16>(Required(c, "code"));
	UINT8 const record = static_cast<UINT8>(Integer(c, "record", 0));
	SetupActionContext(c, npc);
	RunActionProbe(c, npc, "", [&] { HandleNPCDoAction(npc, code, record); });
}

MessageBoxReturnValue BoxAnswer(Command const& c)
{
	std::string const answer = Text(c, "answer", "yes");
	if (answer == "yes") return MSG_BOX_RETURN_YES;
	if (answer == "no") return MSG_BOX_RETURN_NO;
	if (answer == "lie") return MSG_BOX_RETURN_LIE;
	throw std::runtime_error("answer must be yes, no or lie");
}

long long BoxAmount(UINT16 code, UINT8 profile)
{
	switch (code)
	{
		case NPC_ACTION_ASK_ABOUT_PAYING_RPC:
		case NPC_ACTION_ASK_ABOUT_PAYING_RPC_WITH_DAILY_SALARY:
		case NPC_ACTION_REDUCE_CONRAD_SALARY_CONDITIONS:
			return gMercProfiles[profile].sSalary;
		case NPC_ACTION_BUY_LEATHER_KEVLAR_VEST:
			return GCM->getItem(LEATHER_JACKET_W_KEVLAR)->getPrice();
		case NPC_ACTION_MEDICAL_REQUESTOR:
		{
			INT32 const cost = static_cast<INT32>(CalcMedicalCost(profile));
			return giHospitalRefund > cost ? 10 : cost - giHospitalRefund;
		}
		case NPC_ACTION_BUY_VEHICLE_REQUESTOR:
			return 10000;
		default:
			return -1;
	}
}

void ProbeNpcBox(Command const& c)
{
	UINT8 const npc = static_cast<UINT8>(Required(c, "npc"));
	UINT16 const code = static_cast<UINT16>(Required(c, "code"));
	UINT8 const record = static_cast<UINT8>(Integer(c, "record", 0));
	MessageBoxReturnValue const answer = BoxAnswer(c);
	SetupActionContext(c, npc);
	if (!gpDestSoldier) throw std::runtime_error("npcbox needs a panel soldier (dest)");
	long long const amount = BoxAmount(code, gpDestSoldier->ubProfile);
	RunActionProbe(c, npc, Json{}.num("amount", amount).text(), [&] { OracleAnswerDialogueMessageBox(code, record, answer); });
}

void ProbeNpcEvent(Command const& c)
{
	UINT32 const param = static_cast<UINT32>(Required(c, "param"));
	SetupActionContext(c, NO_PROFILE);
	RunActionProbe(c, NO_PROFILE, Json{}.raw("poolBefore", DescribeDeliveryPool()).text(), [&] { HandleNPCSystemEvent(param); });
}

void ProbeKingpinMoney(Command const& c)
{
	BOOLEAN const first = Integer(c, "first", 1) != 0;
	SetupActionContext(c, NO_PROFILE);
	RunActionProbe(c, KINGPIN, Json{}.raw("moneyBefore", DescribeWorldMoney()).text(), [&] { CheckForKingpinsMoneyMissing(first); });
}

void ProbeHospitalSupplies(Command const& c)
{
	SetupActionContext(c, NO_PROFILE);
	UINT8 const count = HospitalSupplyCount();
	RunActionProbe(c, NO_PROFILE, Json{}.num("count", count).text(), [] { CheckForMissingHospitalSupplies(); });
}

void ProbeMedicalCost(Command const& c)
{
	UINT8 const npc = static_cast<UINT8>(Required(c, "npc"));
	std::vector<std::string> patients;
	FOR_EACH_IN_TEAM(s, OUR_TEAM)
	{
		if (!s->bInSector) continue;
		patients.push_back(Numbers({s->ubID, s->bLife, s->bLifeMax, s->bBleeding, s->bHospitalPriceModifier, s->bAssignment,
			static_cast<long long>(CalcPatientMedicalCost(s))}));
	}
	Emit(Json{}.str("probe", "medicalcost").num("line", c.line).num("npc", npc).num("cost", CalcMedicalCost(npc))
		.raw("patients", JsonArray(patients)).nums("hospital", {gbHospitalPriceModifier, giHospitalTempBalance, giHospitalRefund}));
}

void SetPairs(Command const& c, char const* key, UINT8* array)
{
	if (!Has(c, key)) return;
	for (std::string const& kv : SplitList(Text(c, key, ""), ','))
	{
		std::vector<std::string> const parts = SplitList(kv, ':');
		array[std::stoi(parts.at(0))] = static_cast<UINT8>(std::stoi(parts.at(1)));
	}
}

void SetNpcState(Command const& c)
{
	SetPairs(c, "facts", gubFact);
	SetPairs(c, "quests", gubQuest);
	SetIfGiven(c, "modifier", gbHospitalPriceModifier);
	SetIfGiven(c, "temp", giHospitalTempBalance);
	SetIfGiven(c, "refund", giHospitalRefund);
	SetIfGiven(c, "objects", gubCambriaMedicalObjects);
	if (Has(c, "who"))
	{
		SOLDIERTYPE& s = ExistingSoldier(Required(c, "who"));
		SetIfGiven(c, "life", s.bLife);
		SetIfGiven(c, "bleeding", s.bBleeding);
		SetIfGiven(c, "patientmod", s.bHospitalPriceModifier);
		SetIfGiven(c, "neutral", s.bNeutral);
	}
	if (Has(c, "profile"))
	{
		MERCPROFILESTRUCT& p = GetProfile(static_cast<ProfileID>(Required(c, "profile")));
		SetIfGiven(c, "balance", p.iBalance);
		SetIfGiven(c, "npcdata", p.bNPCData);
		SetIfGiven(c, "npcdata2", p.bNPCData2);
		SetIfGiven(c, "salary", p.sSalary);
		SetIfGiven(c, "status", p.bMercStatus);
		SetIfGiven(c, "money", p.uiMoney);
		if (Has(c, "sector"))
		{
			p.sSector = StrategicSectorArgument(c, "sector");
			p.sSector.z = static_cast<INT8>(Integer(c, "z", 0));
		}
	}
	Emit(Json{}.str("probe", "npcset").num("line", c.line).raw("args", DescribeArgs(c)));
}

std::string DescribeScheduleNode(SCHEDULENODE const& n)
{
	std::vector<long long> times, data1, data2, actions;
	for (int i = 0; i < MAX_SCHEDULE_ACTIONS; ++i)
	{
		times.push_back(n.usTime[i]);
		data1.push_back(n.usData1[i]);
		data2.push_back(n.usData2[i]);
		actions.push_back(n.ubAction[i]);
	}
	return Json{}
		.num("id", n.ubScheduleID)
		.num("flags", n.usFlags)
		.nums("times", times)
		.nums("data1", data1)
		.nums("data2", data2)
		.nums("actions", actions)
		.num("soldier", n.soldier ? n.soldier->ubID : -1)
		.text();
}

std::string DescribeScheduleCivilian(SOLDIERTYPE const& s)
{
	return Json{}
		.num("id", s.ubID)
		.num("profile", s.ubProfile)
		.num("body", s.ubBodyType)
		.num("life", s.bLife)
		.num("gridNo", s.sGridNo)
		.num("level", s.bLevel)
		.flag("inSector", s.bInSector != 0)
		.flag("away", (s.uiStatusFlags & SOLDIER_OFF_MAP) != 0)
		.flag("asleep", (s.fAIFlags & AI_ASLEEP) != 0)
		.flag("checkSchedule", (s.fAIFlags & AI_CHECK_SCHEDULE) != 0)
		.flag("lockIncludesClose", (s.fAIFlags & AI_LOCK_DOOR_INCLUDES_CLOSE) != 0)
		.num("scheduleId", s.ubScheduleID)
		.num("progress", s.bAIScheduleProgress)
		.num("initialGridNo", s.sInitialGridNo)
		.num("offWorldGridNo", s.sOffWorldGridNo)
		.num("patrol0", s.usPatrolGrid[0])
		.num("quoteAction", s.ubQuoteActionID)
		.text();
}

std::string DescribeScheduleState()
{
	std::vector<std::string> schedules;
	for (SCHEDULENODE const* n = gpScheduleList; n; n = n->next) schedules.push_back(DescribeScheduleNode(*n));
	std::vector<std::string> civilians;
	FOR_EACH_IN_TEAM(s, CIV_TEAM) civilians.push_back(DescribeScheduleCivilian(*s));
	std::vector<std::string> doors;
	for (DOOR const& d : DoorTable)
	{
		STRUCTURE const* const door = FindStructure(d.sGridNo, STRUCTURE_ANYDOOR);
		doors.push_back(Numbers({d.sGridNo, d.fLocked ? 1 : 0, door && (door->fFlags & STRUCTURE_OPEN) ? 1 : 0}));
	}
	std::vector<std::string> events;
	for (STRATEGICEVENT const* e = gpEventList; e; e = e->next)
	{
		if (e->ubCallbackID == EVENT_PROCESS_TACTICAL_SCHEDULE) events.push_back(Numbers({static_cast<long long>(e->uiTimeStamp), static_cast<long long>(e->uiParam)}));
	}
	return Json{}
		.num("worldSeconds", GetWorldTotalSeconds())
		.num("lastEventQuery", guiTimeOfLastEventQuery)
		.num("lastId", gubScheduleID)
		.raw("worldSector", Numbers({gWorldSector.x, gWorldSector.y, gWorldSector.z}))
		.raw("schedules", JsonArray(schedules))
		.raw("civilians", JsonArray(civilians))
		.raw("doors", JsonArray(doors))
		.raw("events", JsonArray(events))
		.text();
}

void EmitSchedules(Command const& c, std::string const& draws, std::string const& result)
{
	Emit(Json{}
		.str("probe", c.name)
		.num("line", c.line)
		.raw("args", DescribeArgs(c))
		.raw("draws", draws.empty() ? "[]" : draws)
		.raw("result", result.empty() ? "null" : result)
		.raw("state", DescribeScheduleState()));
}

ScreenID ScheduleScreenArgument(Command const& c)
{
	std::string const screen = Text(c, "screen", "map");
	if (screen == "game") return GAME_SCREEN;
	if (screen == "map") return MAP_SCREEN;
	throw std::runtime_error("screen must be game or map");
}

void DumpSchedules(Command const& c)
{
	EmitSchedules(c, "", "");
}

void ProbeScheduleLoad(Command const& c)
{
	std::string const name = Text(c, "name", "");
	if (name.empty()) throw std::runtime_error("schedload needs name=SaveGameNN");
	std::string const draws = TracedSaiDraws([&name] {
		LoadSavedGame(ST::string(name));
		OracleResetContractRenewalSequence();
	});
	EmitSchedules(c, draws, "");
}

void ProbeScheduleEntry(Command const& c)
{
	SGPSector sector = StrategicSectorArgument(c, "sector");
	sector.z = static_cast<INT8>(Integer(c, "z", 0));
	std::string const draws = TracedSaiDraws([&sector] { SetCurrentWorldSector(sector); });
	EmitSchedules(c, draws, "");
}

void SetScheduleClock(Command const& c)
{
	UINT32 const seconds = static_cast<UINT32>(Required(c, "seconds"));
	guiGameClock = seconds;
	guiTimeOfLastEventQuery = static_cast<UINT32>(Integer(c, "query", seconds));
	UpdateGameClockGlobals(gpGameClockString);
	EmitSchedules(c, "", "");
}

void ProbeScheduleWarp(Command const& c)
{
	UINT32 const minutes = static_cast<UINT32>(Required(c, "minutes"));
	ScreenID const saved = guiCurrentScreen;
	guiCurrentScreen = ScheduleScreenArgument(c);
	std::string const draws = TracedSaiDraws([minutes] { WarpGameTime(minutes * NUM_SEC_IN_MIN, WARPTIME_PROCESS_EVENTS_NORMALLY); });
	guiCurrentScreen = saved;
	EmitSchedules(c, draws, "");
}

void ProbeScheduleProcess(Command const& c)
{
	ScreenID const saved = guiCurrentScreen;
	guiCurrentScreen = ScheduleScreenArgument(c);
	UINT8 const id = static_cast<UINT8>(Required(c, "id"));
	ProcessTacticalSchedule(id);
	guiCurrentScreen = saved;
	EmitSchedules(c, "", "");
}

void ProbeScheduleDecision(Command const& c)
{
	SOLDIERTYPE& s = GetMan(static_cast<UINT>(Required(c, "soldier")));
	if (!s.bActive) throw std::runtime_error("no active soldier");
	INT8 const action = OracleDecideActionSchedule(&s);
	EmitSchedules(c, "", Json{}
		.num("action", action)
		.num("actionData", s.usActionData)
		.num("absoluteFinalDestination", s.sAbsoluteFinalDestination)
		.num("soldier", s.ubID)
		.text());
}

void MoveScheduleSoldier(Command const& c)
{
	SOLDIERTYPE& s = GetMan(static_cast<UINT>(Required(c, "soldier")));
	if (!s.bActive) throw std::runtime_error("no active soldier");
	EVENT_SetSoldierPositionNoCenter(&s, static_cast<GridNo>(Required(c, "gridNo")), SSP_FORCE_DELETE);
	EmitSchedules(c, "", "");
}

void ProbeScheduleShopHours(Command const& c)
{
	ProfileID const profile = static_cast<ProfileID>(Required(c, "profile"));
	SOLDIERTYPE* const s = FindSoldierByProfileID(profile);
	UINT32 open = 0;
	UINT32 close = 0;
	bool const found = s && ExtractScheduleDoorLockAndUnlockInfo(s, &open, &close);
	EmitSchedules(c, "", Json{}.flag("found", found).num("open", open).num("close", close).text());
}


} // namespace

std::vector<ProfileID>* gOracleDeferredEpcs = nullptr;

BOOLEAN OracleTracedMercDialogue(SOLDIERTYPE const* const s, UINT16 const quote)
{
	BOOLEAN const said = TacticalCharacterDialogue(s, quote);
	if (said) OracleDialogueTrace("merc", s->ubProfile, quote, 0, 0);
	return said;
}

INT8 CalcInterruptDuelPts(const SOLDIERTYPE* pSoldier, const SOLDIERTYPE* opponent, BOOLEAN fUseWatchSpots);

namespace {

void AppendRecruitItems(std::vector<long long>& row, SOLDIERTYPE const& s)
{
	for (OBJECTTYPE const& o : s.inv) row.push_back(o.usItem);
}

std::string DescribeRecruitTeam()
{
	std::vector<std::string> out;
	FOR_EACH_IN_TEAM(s, OUR_TEAM)
	{
		bool const here = s->bInSector;
		std::vector<long long> row{s->ubID, s->ubProfile, s->ubWhatKindOfMercAmI, s->bAssignment, s->sSector.x, s->sSector.y, s->sSector.z,
			s->fBetweenSectors, s->ubGroupID, here, here ? s->sGridNo : -1, here ? s->bDirection : -1, here ? s->bLevel : -1, s->bLife,
			s->bLifeMax, s->bAgility, s->bDexterity, s->bStrength, s->bWisdom, s->bLeadership, s->bMarksmanship, s->bMechanical,
			s->bExplosive, s->bMedical, s->bExpLevel, s->bBleeding, s->bBreath, s->bMorale, s->bCamo, s->bVisible, s->ubBodyType,
			s->iEndofContractTime, s->robot_remote_holder ? s->robot_remote_holder->ubID : -1, here ? -1 : s->ubStrategicInsertionCode,
			s->ubInsertionDirection};
		AppendRecruitItems(row, *s);
		out.push_back(Numbers(row));
	}
	return JsonArray(out);
}

std::string DescribeRecruitSquads()
{
	std::vector<std::string> out;
	for (INT8 q = 0; q < NUMBER_OF_SQUADS; ++q)
	{
		std::vector<long long> ids;
		FOR_EACH_IN_SQUAD(i, q) ids.push_back((*i)->ubID);
		out.push_back(Numbers(ids));
	}
	return JsonArray(out);
}

std::string DescribeRecruitCivilians(bool const all)
{
	std::vector<std::string> out;
	FOR_EACH_SOLDIER(s)
	{
		if (s->bTeam == OUR_TEAM || !s->bInSector) continue;
		if (!all && s->ubProfile == NO_PROFILE) continue;
		std::vector<long long> row{s->ubID, s->ubProfile, s->bTeam, s->bNeutral, s->bLife, s->bLifeMax, s->sGridNo, s->bDirection, s->bLevel,
			s->ubCivilianGroup, s->ubBodyType, s->bAgility, s->bDexterity, s->bStrength, s->bWisdom, s->bLeadership, s->bMarksmanship,
			s->bMechanical, s->bExplosive, s->bMedical, s->bExpLevel, s->bCamo};
		AppendRecruitItems(row, *s);
		out.push_back(Numbers(row));
	}
	return JsonArray(out);
}

std::string DescribeRecruitPersonnel()
{
	std::vector<long long> other;
	for (INT16 const p : LaptopSaveInfo.ubOtherCharactersList)
		if (p != -1) other.push_back(p);
	return Numbers(other);
}

std::string DescribeRecruitLoyalty()
{
	std::vector<std::string> out;
	for (INT8 town = FIRST_TOWN; town < NUM_TOWNS; ++town) out.push_back(Numbers({gTownLoyalty[town].ubRating, gTownLoyalty[town].sChange}));
	return JsonArray(out);
}

template<typename Run>
void RunRecruitProbe(Command const& c, UINT8 const npc, Run&& run)
{
	ActionSnapshot const before = TakeActionSnapshot();
	std::vector<OracleDialogueEntry> dialogue;
	std::vector<OracleFactEntry> facts;
	std::vector<OracleDraw> draws;
	gOracleSkipDialogueBoxes = true;
	gOracleDialogueTrace = &dialogue;
	gOracleFactTrace = &facts;
	OracleTraceRandom(&draws);
	run();
	OracleTraceRandom(nullptr);
	gOracleFactTrace = nullptr;
	gOracleDialogueTrace = nullptr;
	gOracleSkipDialogueBoxes = false;
	Emit(Json{}
		.str("probe", c.name)
		.num("line", c.line)
		.raw("args", DescribeArgs(c))
		.num("npc", npc)
		.raw("queue", DescribeDialogueTrace(dialogue))
		.raw("facts", DescribeFactTrace(facts))
		.raw("draws", DescribeDraws(draws))
		.raw("factChanges", DescribeChanges(before.facts, gubFact, NUM_FACTS))
		.raw("questChanges", DescribeChanges(before.quests, gubQuest, MAX_QUESTS))
		.raw("events", DescribeNewEvents(before))
		.raw("history", DescribeHistoryTail(before.history))
		.raw("box", Numbers({OracleDialogueMessageBoxType(), OracleLiePromptRecord()}))
		.raw("team", DescribeRecruitTeam())
		.raw("squads", DescribeRecruitSquads())
		.num("currentSquad", CurrentSquad())
		.raw("civilians", DescribeRecruitCivilians(Text(c, "soldiers", "") == "all"))
		.raw("profiles", DescribeNarrativeProfiles(ActionProfileIds(c, {npc})))
		.raw("personnel", DescribeRecruitPersonnel())
		.raw("loyalty", DescribeRecruitLoyalty())
		.num("salary", npc < NUM_PROFILES ? GetProfile(npc).sSalary : 0)
		.num("worldMinutes", GetWorldTotalMin()));
	ResetTalkProbe();
}

void ProbeAddNpc(Command const& c)
{
	if (!gfWorldLoaded) throw std::runtime_error("no world loaded");
	ProfileID const profile = static_cast<ProfileID>(Required(c, "profile"));
	if (FindSoldierByProfileID(profile)) throw std::runtime_error("the profile already has a soldier");
	GridNo const at = GridArgument(c, "at");
	SOLDIERCREATE_STRUCT cs{};
	cs.bTeam            = CIV_TEAM;
	cs.ubProfile        = profile;
	cs.sSector          = gWorldSector;
	cs.bDirection       = static_cast<INT8>(Integer(c, "dir", SOUTH));
	cs.sInsertionGridNo = at;
	std::vector<OracleDraw> draws;
	OracleTraceRandom(&draws);
	SOLDIERTYPE* const s = TacticalCreateSoldier(cs);
	if (s) AddSoldierToSectorNoCalculateDirection(s);
	OracleTraceRandom(nullptr);
	if (!s) throw std::runtime_error("TacticalCreateSoldier failed");
	if (s->sGridNo != at) EVENT_SetSoldierPosition(s, at, SSP_NONE);
	Emit(Json{}.str("probe", "addnpc").num("line", c.line).raw("args", DescribeArgs(c)).num("id", s->ubID).raw("draws", DescribeDraws(draws))
		.raw("civilians", DescribeRecruitCivilians(false)));
}

void ProbeRecruitSet(Command const& c)
{
	if (Has(c, "who"))
	{
		SOLDIERTYPE& s = ExistingSoldier(Required(c, "who"));
		INT8 const slot = static_cast<INT8>(Required(c, "slot"));
		UINT16 const item = static_cast<UINT16>(Integer(c, "item", NOTHING));
		INT8 const status = static_cast<INT8>(Integer(c, "status", 100));
		if (Integer(c, "place", 0) != 0)
		{
			OBJECTTYPE o;
			CreateItem(item, status, &o);
			if (!PlaceObject(&s, slot, &o)) throw std::runtime_error("PlaceObject refused");
		}
		else if (item == NOTHING) s.inv[slot] = OBJECTTYPE{};
		else CreateItem(item, status, &s.inv[slot]);
	}
	if (Has(c, "profile"))
	{
		MERCPROFILESTRUCT& p = GetProfile(static_cast<ProfileID>(Required(c, "profile")));
		SetIfGiven(c, "town", p.bTown);
		SetIfGiven(c, "attachment", p.bTownAttachment);
		SetIfGiven(c, "salary", p.sSalary);
		SetIfGiven(c, "flags", p.ubMiscFlags);
		SetIfGiven(c, "flags3", p.ubMiscFlags3);
	}
	SetPairs(c, "facts", gubFact);
	SetPairs(c, "quests", gubQuest);
	if (Has(c, "squad")) iCurrentTacticalSquad = static_cast<INT32>(Required(c, "squad"));
	Emit(Json{}.str("probe", "recruitset").num("line", c.line).raw("args", DescribeArgs(c)).raw("team", DescribeRecruitTeam()));
}

void ProbeRecruit(Command const& c)
{
	UINT8 const npc = static_cast<UINT8>(Required(c, "npc"));
	std::string const action = Text(c, "action", "rpc");
	UINT8 const record = static_cast<UINT8>(Integer(c, "record", 0));
	SetupActionContext(c, npc);
	RunRecruitProbe(c, npc, [&] {
		if (action == "rpc") HandleNPCDoAction(npc, NPC_ACTION_RECRUIT_WITH_SALARY, record);
		else if (action == "free") HandleNPCDoAction(npc, NPC_ACTION_RECRUIT, record);
		else if (action == "unrecruit") HandleNPCDoAction(npc, NPC_ACTION_UN_RECRUIT_EPC, record);
		else if (action == "settonpc") HandleNPCDoAction(npc, NPC_ACTION_SET_EPC_TO_NPC, record);
		else if (action == "marry") HandleNPCDoAction(npc, NPC_ACTION_REMOVE_MERC_FOR_MARRIAGE, record);
		else if (action == "enemy") HandleNPCDoAction(npc, NPC_ACTION_BECOME_ENEMY, record);
		else if (action == "epc")
		{
			if (!gpDestSoldier) throw std::runtime_error("recruit action=epc needs the NPC's soldier");
			OracleAnswerDialogueMessageBox(NPC_ACTION_ASK_ABOUT_ESCORTING_EPC, record, MSG_BOX_RETURN_YES);
		}
		else throw std::runtime_error("action must be rpc, free, epc, unrecruit, settonpc, marry or enemy");
	});
}

void ProbeUnescort(Command const& c)
{
	UINT8 const npc = static_cast<UINT8>(Required(c, "npc"));
	SOLDIERTYPE* const s = FindSoldierByProfileIDOnPlayerTeam(npc);
	if (!s) throw std::runtime_error("unescort: the profile is not on the team");
	BOOLEAN const map = Integer(c, "map", 1) != 0;
	SetupActionContext(c, NO_PROFILE);
	std::vector<ProfileID> deferred;
	RunRecruitProbe(c, npc, [&] {
		BOOLEAN const saved = fInMapMode;
		fInMapMode = map;
		gOracleDeferredEpcs = &deferred;
		UnEscortEPC(s);
		gOracleDeferredEpcs = nullptr;
		fInMapMode = saved;
		for (ProfileID const p : deferred)
		{
			GetProfile(p).ubMiscFlags &= ~PROFILE_MISC_FLAG_FORCENPCQUOTE;
			UnRecruitEPC(p);
		}
	});
}

void ProbeRobotControl(Command const& c)
{
	SOLDIERTYPE* const robot = FindSoldierByProfileIDOnPlayerTeam(ROBOT);
	if (Integer(c, "update", 0) != 0 && robot) UpdateRobotControllerGivenRobot(robot);
	SOLDIERTYPE const* const opp = Has(c, "opp") ? &ExistingSoldier(Required(c, "opp")) : nullptr;
	std::vector<std::string> mercs;
	FOR_EACH_IN_TEAM(s, OUR_TEAM)
	{
		std::vector<long long> row{s->ubID, ControllingRobot(s)};
		if (opp && s->bInSector) row.push_back(CalcInterruptDuelPts(s, opp, FALSE));
		mercs.push_back(Numbers(row));
	}
	SOLDIERTYPE const* const holder = robot ? robot->robot_remote_holder : nullptr;
	Emit(Json{}.str("probe", "robotcontrol").num("line", c.line).raw("args", DescribeArgs(c)).num("robot", robot ? robot->ubID : -1)
		.num("holder", holder ? holder->ubID : -1).num("controlled", robot && CanRobotBeControlled(robot) ? 1 : 0)
		.raw("mercs", JsonArray(mercs)));
}

} // namespace

#include "Civ_Quotes.h"

void OracleSurrenderAnswer(bool yes);
INT8 OracleDecideActionNamedNPC(SOLDIERTYPE* s);
bool OracleOfferSurrenderNow(SOLDIERTYPE* s);
BOOLEAN OracleAiPause(UINT32* timer);
void OracleSetAiPause(BOOLEAN paused, UINT32 timer);

namespace {
struct OracleCivQuoteSaid
{
	int soldier, quote, entry;
	long long length;
};

bool gOracleCivHeadless = false;
std::vector<OracleCivQuoteSaid> gOracleCivSaid;
}

bool OracleCivQuoteHeadless(SOLDIERTYPE* const civ, UINT8 const quote, UINT8 const entry, size_t const length)
{
	if (!gOracleCivHeadless) return false;
	gOracleCivSaid.push_back({civ->ubID, quote, entry, static_cast<long long>(length)});
	return true;
}

namespace {
std::string DescribeCivSoldier(SOLDIERTYPE const& s)
{
	return Json{}
		.num("id", s.ubID)
		.num("currentCivQuote", s.bCurrentCivQuote)
		.num("delta", s.bCurrentCivQuoteDelta)
		.num("action", s.bAction)
		.num("actionData", s.usActionData)
		.num("quoteRecord", s.ubQuoteRecord)
		.num("quoteActionId", s.ubQuoteActionID)
		.num("handleEveryFrame", (s.fAIFlags & AI_HANDLE_EVERY_FRAME) ? 1 : 0)
		.num("neutral", s.bNeutral)
		.text();
}

std::string DescribeCivSaid()
{
	std::vector<std::string> items;
	for (auto const& e : gOracleCivSaid) items.push_back(Numbers({e.soldier, e.quote, e.entry, e.length}));
	return JsonArray(items);
}

std::string DescribeCivRecordFlags()
{
	std::vector<std::string> files;
	for (int i = 0; i < 20; ++i)
	{
		NPCQuoteInfo const* q = OracleCivQuoteArray(static_cast<UINT8>(i));
		if (!q)
		{
			files.push_back("null");
			continue;
		}
		std::vector<long long> flags;
		for (int r = 0; r < NUM_NPC_QUOTE_RECORDS; ++r) flags.push_back(q[r].fFlags);
		files.push_back(Numbers(flags));
	}
	return JsonArray(files);
}

std::string QuestDelta(std::vector<UINT8> const& before)
{
	std::vector<std::string> changes;
	for (int q = 0; q < MAX_QUESTS; ++q)
		if (before[q] != gubQuest[q]) changes.push_back(Numbers({q, before[q], gubQuest[q]}));
	return JsonArray(changes);
}

std::string FactDelta(std::vector<UINT8> const& before)
{
	std::vector<std::string> changes;
	for (int f = 0; f < NUM_FACTS; ++f)
		if (before[f] != gubFact[f]) changes.push_back(Numbers({f, before[f], gubFact[f]}));
	return JsonArray(changes);
}

std::string DescribeAiPauseState()
{
	UINT32 timer = 0;
	BOOLEAN const paused = OracleAiPause(&timer);
	return Json{}.flag("paused", paused).flag("timed", timer != 0).text();
}

std::string DescribeHostileList()
{
	std::vector<UINT8> list;
	OracleHostileQuoteList(&list);
	return Numbers(std::vector<long long>(list.begin(), list.end()));
}

std::string DescribeCapturedMercs()
{
	std::vector<std::string> mercs;
	CFOR_EACH_IN_TEAM(s, OUR_TEAM)
	{
		mercs.push_back(Json{}
			.num("id", s->ubID)
			.flag("inSector", s->bInSector)
			.num("life", s->bLife)
			.num("breath", s->bBreath)
			.num("assignment", s->bAssignment)
			.nums("sector", {s->sSector.x, s->sSector.y, s->sSector.z})
			.num("insertionCode", s->ubStrategicInsertionCode)
			.num("insertionData", s->usStrategicInsertionData)
			.num("neutral", s->bNeutral)
			.text());
	}
	return JsonArray(mercs);
}

std::pair<int, int> PairArgument(std::string const& spec, char const* what)
{
	std::vector<std::string> const parts = SplitList(spec, ':');
	if (parts.size() != 2) throw std::runtime_error(std::string(what) + " looks like <a>:<b>");
	return {static_cast<int>(ParseInteger(what, parts[0])), static_cast<int>(ParseInteger(what, parts[1]))};
}

void ApplyCivSoldierSetup(Command const& c, SOLDIERTYPE& s)
{
	SetIfGiven(c, "quote", s.bCurrentCivQuote);
	SetIfGiven(c, "delta", s.bCurrentCivQuoteDelta);
	SetIfGiven(c, "action", s.bAction);
	SetIfGiven(c, "life", s.bLife);
	SetIfGiven(c, "class", s.ubSoldierClass);
	SetIfGiven(c, "visible", s.bVisible);
	SetIfGiven(c, "quoteRecord", s.ubQuoteRecord);
	SetIfGiven(c, "quoteAction", s.ubQuoteActionID);
	SetIfGiven(c, "neutral", s.bNeutral);
	SetIfGiven(c, "group", s.ubCivilianGroup);
	if (Has(c, "cower"))
	{
		if (Integer(c, "cower", 0) != 0) s.uiStatusFlags |= SOLDIER_COWERING;
		else s.uiStatusFlags &= ~SOLDIER_COWERING;
	}
	if (Has(c, "dir"))
	{
		INT8 const dir = static_cast<INT8>(Integer(c, "dir", 0));
		EVENT_SetSoldierDirection(&s, dir);
		EVENT_SetSoldierDesiredDirection(&s, dir);
	}
	if (Has(c, "grid")) EVENT_SetSoldierPosition(&s, static_cast<GridNo>(Integer(c, "grid", 0)), SSP_NONE);
	if (Has(c, "sees"))
	{
		for (std::string const& id : SplitList(Text(c, "sees", ""), ','))
		{
			SoldierID const opp = static_cast<SoldierID>(ParseInteger("sees", id));
			if (s.bOppList[opp] != SEEN_CURRENTLY) ++s.bOppCnt;
			s.bOppList[opp] = SEEN_CURRENTLY;
		}
	}
	if (Has(c, "unseen"))
	{
		for (std::string const& id : SplitList(Text(c, "unseen", ""), ','))
		{
			SoldierID const opp = static_cast<SoldierID>(ParseInteger("unseen", id));
			if (s.bOppList[opp] == SEEN_CURRENTLY) --s.bOppCnt;
			s.bOppList[opp] = NOT_HEARD_OR_SEEN;
		}
	}
}

void ApplyCivSetup(Command const& c)
{
	if (Has(c, "who")) ApplyCivSoldierSetup(c, ExistingSoldier(Required(c, "who")));
	if (Has(c, "rating"))
	{
		auto const [town, rating] = PairArgument(Text(c, "rating", ""), "rating");
		gTownLoyalty[town].ubRating = static_cast<UINT8>(rating);
	}
	if (Has(c, "combat"))
	{
		if (Integer(c, "combat", 0) != 0) gTacticalStatus.uiFlags |= INCOMBAT;
		else gTacticalStatus.uiFlags &= ~INCOMBAT;
	}
	for (std::string const& spec : SplitList(Text(c, "fact", ""), ','))
	{
		auto const [fact, value] = PairArgument(spec, "fact");
		gubFact[fact] = static_cast<UINT8>(value);
	}
	for (std::string const& spec : SplitList(Text(c, "quest", ""), ','))
	{
		auto const [quest, value] = PairArgument(spec, "quest");
		gubQuest[quest] = static_cast<UINT8>(value);
	}
	for (std::string const& id : SplitList(Text(c, "listadd", ""), ','))
		AddToShouldBecomeHostileOrSayQuoteList(&ExistingSoldier(ParseInteger("listadd", id)));
	if (Has(c, "enemyFlags")) gTacticalStatus.fEnemyFlags = static_cast<UINT8>(Integer(c, "enemyFlags", 0));
	if (Has(c, "pause")) OracleSetAiPause(Integer(c, "pause", 0) != 0, 0);
}

void SetCivState(Command const& c)
{
	ApplyCivSetup(c);
	Json json;
	json.str("probe", "civset").num("line", c.line).raw("args", DescribeArgs(c));
	if (Has(c, "who")) json.raw("soldier", DescribeCivSoldier(ExistingSoldier(Required(c, "who"))));
	Emit(json);
}

void ProbeCivQuote(Command const& c)
{
	SOLDIERTYPE& s = ExistingSoldier(Required(c, "who"));
	std::string const before = DescribeCivSoldier(s);
	std::vector<UINT8> const quests(gubQuest, gubQuest + MAX_QUESTS);
	std::vector<OracleFactEntry> facts;
	gOracleCivSaid.clear();
	gOracleCivHeadless = true;
	gOracleFactTrace = &facts;
	std::string const draws = TracedSaiDraws([&] { StartCivQuote(&s); });
	gOracleFactTrace = nullptr;
	gOracleCivHeadless = false;
	Emit(Json{}
		.str("probe", "civquote")
		.num("line", c.line)
		.num("who", s.ubID)
		.raw("before", before)
		.raw("after", DescribeCivSoldier(s))
		.raw("said", DescribeCivSaid())
		.raw("facts", DescribeFactTrace(facts))
		.raw("draws", draws)
		.raw("questChanges", QuestDelta(quests))
		.raw("civFlags", DescribeCivRecordFlags()));
}

template<typename Run, typename Extra>
void EmitDialogueProbe(Command const& c, char const* name, Run&& run, Extra&& extra)
{
	std::vector<UINT8> const factsBefore(gubFact, gubFact + NUM_FACTS);
	std::vector<UINT8> const quests(gubQuest, gubQuest + MAX_QUESTS);
	std::vector<OracleDialogueEntry> dialogue;
	std::vector<OracleFactEntry> facts;
	ResetTalkProbe();
	gfWaitingForTriggerTimer = FALSE;
	gOracleDialogueTrace = &dialogue;
	gOracleFactTrace = &facts;
	std::string const draws = TracedSaiDraws(run);
	gOracleFactTrace = nullptr;
	gOracleDialogueTrace = nullptr;
	Json json;
	json.str("probe", name).num("line", c.line);
	extra(json);
	Emit(json
		.raw("queue", DescribeDialogueTrace(dialogue))
		.raw("facts", DescribeFactTrace(facts))
		.raw("draws", draws)
		.raw("factChanges", FactDelta(factsBefore))
		.raw("questChanges", QuestDelta(quests))
		.flag("waitingForTrigger", gfWaitingForTriggerTimer)
		.raw("hostileList", DescribeHostileList())
		.raw("aiPause", DescribeAiPauseState())
		.raw("civ", DescribeCivState()));
	ResetTalkProbe();
	gfWaitingForTriggerTimer = FALSE;
}

void ProbeNamedNpc(Command const& c)
{
	SOLDIERTYPE& s = ExistingSoldier(Required(c, "who"));
	std::string const before = DescribeCivSoldier(s);
	INT8 action = AI_ACTION_NONE;
	EmitDialogueProbe(c, "namednpc", [&] { action = OracleDecideActionNamedNPC(&s); }, [&](Json& json) {
		json.num("who", s.ubID).num("action", action).raw("before", before).raw("after", DescribeCivSoldier(s));
	});
}

void ProbeInitiating(Command const& c)
{
	SOLDIERTYPE& s = ExistingSoldier(Required(c, "who"));
	std::vector<OracleFactEntry> facts;
	gOracleFactTrace = &facts;
	INT16 const grid = NPCConsiderInitiatingConv(&s);
	gOracleFactTrace = nullptr;
	Emit(Json{}
		.str("probe", "initiating")
		.num("line", c.line)
		.num("who", s.ubID)
		.num("grid", grid == NOWHERE ? -1 : grid)
		.raw("facts", DescribeFactTrace(facts))
		.raw("profile", DescribeNpcProfile(s.ubProfile)));
}

void ProbePcsNear(Command const& c)
{
	UINT8 const npc = static_cast<UINT8>(Required(c, "npc"));
	SOLDIERTYPE const* const s = FindSoldierByProfileID(npc);
	EmitDialogueProbe(c, "pcsnear", [&] { PCsNearNPC(npc); }, [&](Json& json) {
		json.num("npc", npc).raw("soldier", s ? DescribeCivSoldier(*s) : "null");
	});
}

void ProbeFirstAid(Command const& c)
{
	UINT8 const npc = static_cast<UINT8>(Required(c, "npc"));
	BOOLEAN refused = FALSE;
	EmitDialogueProbe(c, "firstaid", [&] { refused = PCDoesFirstAidOnNPC(npc); }, [&](Json& json) {
		json.num("npc", npc).flag("refused", refused).raw("profile", DescribeNpcProfile(npc));
	});
}

void ProbeFriendHostile(Command const& c)
{
	UINT8 const npc = static_cast<UINT8>(Required(c, "npc"));
	EmitDialogueProbe(c, "friendhostile", [&] { TriggerFriendWithHostileQuote(npc); }, [&](Json& json) { json.num("npc", npc); });
}

std::string DescribeListedSpeakers(std::vector<UINT8> const& list)
{
	std::vector<std::string> items;
	for (UINT8 const id : list) items.push_back(Numbers({id, GetMan(id).bVisible, gbPublicOpplist[OUR_TEAM][id]}));
	return JsonArray(items);
}

void ProbeHostileCheck(Command const& c)
{
	std::vector<UINT8> list;
	OracleHostileQuoteList(&list);
	std::string const before = DescribeListedSpeakers(list);
	EmitDialogueProbe(c, "hostilecheck", [] { CheckHostileOrSayQuoteList(); }, [&](Json& json) {
		json.raw("listedBefore", before).raw("listedAfter", DescribeListedSpeakers(list));
	});
}

void ProbeSurrender(Command const& c)
{
	SOLDIERTYPE& s = ExistingSoldier(Required(c, "who"));
	bool const offered = OracleOfferSurrenderNow(&s);
	Emit(Json{}
		.str("probe", "surrender")
		.num("line", c.line)
		.num("who", s.ubID)
		.flag("offered", offered)
		.num("enemyFlags", gTacticalStatus.fEnemyFlags)
		.num("pcs", NumPCsInSector())
		.num("enemies", gTacticalStatus.Team[ENEMY_TEAM].bMenInSector)
		.flag("militia", IsTeamActive(MILITIA_TEAM)));
}

void ProbeSurrenderAnswer(Command const& c)
{
	bool const yes = Text(c, "value", "no") == "yes";
	SOLDIERTYPE const* const who = Has(c, "who") ? &ExistingSoldier(Required(c, "who")) : nullptr;
	std::vector<UINT8> const quests(gubQuest, gubQuest + MAX_QUESTS);
	UINT32 const flagsBefore = gStrategicStatus.uiFlags;
	std::string const draws = TracedSaiDraws([&] { OracleSurrenderAnswer(yes); });
	Emit(Json{}
		.str("probe", "surrenderanswer")
		.num("line", c.line)
		.flag("yes", yes)
		.raw("mercs", DescribeCapturedMercs())
		.raw("questChanges", QuestDelta(quests))
		.num("strategicFlagsBefore", flagsBefore)
		.num("strategicFlags", gStrategicStatus.uiFlags)
		.num("captured", gStrategicStatus.ubNumCapturedForRescue)
		.raw("offering", who ? DescribeCivSoldier(*who) : "null")
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
	if (c.name == "newgamefull") return ProbeNewGameFull(c);
	if (c.name == "arrival") return ProbeArrivalTimes(c);
	if (c.name == "laptop") return DumpLaptop(c);
	if (c.name == "aimhire") return ProbeAimHire(c);
	if (c.name == "mercaccount") return ProbeMercAccount(c);
	if (c.name == "merchire") return ProbeMercHire(c);
	if (c.name == "mercpay") return ProbeMercPay(c);
	if (c.name == "bobbyrestock") return ProbeBobbyRestock(c);
	if (c.name == "bobbyfresh") return ProbeBobbyFresh(c);
	if (c.name == "bobbyorder") return ProbeBobbyOrder(c);
	if (c.name == "bobbydeliver") return ProbeBobbyDeliver(c);
	if (c.name == "setfact") return ProbeFactValue(c);
	if (c.name == "setbalance") return SetLaptopBalance(c);
	if (c.name == "insure") return ProbeInsure(c);
	if (c.name == "insuranceday") return ProbeInsuranceDaily(c);
	if (c.name == "payout") return ProbeInsurancePayout(c);
	if (c.name == "insurancestep") return ProbeInsuranceStep(c);
	if (c.name == "impcreate") return ProbeImpCreate(c);
	if (c.name == "door") return ProbeDoor(c);
	if (c.name == "doormenu") return ProbeDoorMenu(c);
	if (c.name == "locks") return DumpLockTable(c);
	if (c.name == "civgroups") return SetCivGroupState(c);
	if (c.name == "makecivhostile") return ProbeMakeCivHostile(c);
	if (c.name == "pcattack") return ProbePcAttack(c);
	if (c.name == "hostilelist") return ProbeHostileList(c);
	if (c.name == "heli") return DumpHeli(c);
	if (c.name == "heliset") return SetHeli(c);
	if (c.name == "helisetup") return ProbeHeliSetUp(c);
	if (c.name == "heliboard") return ProbeHeliBoard(c);
	if (c.name == "helileave") return ProbeHeliLeave(c);
	if (c.name == "heliroute") return ProbeHeliRoute(c);
	if (c.name == "helicancel") return ProbeHeliCancel(c);
	if (c.name == "heliwarp") return ProbeHeliWarp(c);
	if (c.name == "helimonologue") return ProbeHeliMonologue(c);
	if (c.name == "helipaydebt") return ProbeHeliPayDebt(c);
	if (c.name == "helireturn") return ProbeHeliReturn(c);
	if (c.name == "npcrecords") return DumpNpcRecords(c);
	if (c.name == "npcprofile") return DumpNpcProfile(c);
	if (c.name == "desire") return ProbeDesire(c);
	if (c.name == "consider") return ProbeConsider(c);
	if (c.name == "talk") return ProbeTalk(c);
	if (c.name == "questdecode") return ProbeQuestDecode(c);
	if (c.name == "receive") return ProbeReceive(c);
	if (c.name == "give") return ProbeGive(c);
	if (c.name == "npcgive") return ProbeNpcGive(c);
	if (c.name == "actionitem") return ProbeActionItem(c);
	if (c.name == "narrative") return DumpNarrative(c);
	if (c.name == "setquest") return SetQuestState(c);
	if (c.name == "setnpcprofile") return SetNarrativeProfile(c);
	if (c.name == "checkfact") return ProbeCheckFact(c);
	if (c.name == "quest") return ProbeQuest(c);
	if (c.name == "earlymorning") return ProbeEarlyMorning(c);
	if (c.name == "hourlynpc") return ProbeHourlyNpc(c);
	if (c.name == "questentry") return ProbeQuestEntry(c);
	if (c.name == "questexit") return ProbeQuestExit(c);
	if (c.name == "entersector") return ProbeEnterSector(c);
	if (c.name == "npcaction") return ProbeNpcAction(c);
	if (c.name == "npcbox") return ProbeNpcBox(c);
	if (c.name == "npcevent") return ProbeNpcEvent(c);
	if (c.name == "kingpinmoney") return ProbeKingpinMoney(c);
	if (c.name == "hospitalsupplies") return ProbeHospitalSupplies(c);
	if (c.name == "medicalcost") return ProbeMedicalCost(c);
	if (c.name == "npcset") return SetNpcState(c);
	if (c.name == "addnpc") return ProbeAddNpc(c);
	if (c.name == "recruitset") return ProbeRecruitSet(c);
	if (c.name == "recruit") return ProbeRecruit(c);
	if (c.name == "unescort") return ProbeUnescort(c);
	if (c.name == "robotcontrol") return ProbeRobotControl(c);
	if (c.name == "schedules") return DumpSchedules(c);
	if (c.name == "schedload") return ProbeScheduleLoad(c);
	if (c.name == "schedentry") return ProbeScheduleEntry(c);
	if (c.name == "schedclock") return SetScheduleClock(c);
	if (c.name == "schedwarp") return ProbeScheduleWarp(c);
	if (c.name == "schedprocess") return ProbeScheduleProcess(c);
	if (c.name == "scheddecide") return ProbeScheduleDecision(c);
	if (c.name == "schedshophours") return ProbeScheduleShopHours(c);
	if (c.name == "schedmove") return MoveScheduleSoldier(c);
	if (c.name == "civset") return SetCivState(c);
	if (c.name == "civquote") return ProbeCivQuote(c);
	if (c.name == "namednpc") return ProbeNamedNpc(c);
	if (c.name == "initiating") return ProbeInitiating(c);
	if (c.name == "pcsnear") return ProbePcsNear(c);
	if (c.name == "firstaid") return ProbeFirstAid(c);
	if (c.name == "friendhostile") return ProbeFriendHostile(c);
	if (c.name == "hostilecheck") return ProbeHostileCheck(c);
	if (c.name == "surrender") return ProbeSurrender(c);
	if (c.name == "surrenderanswer") return ProbeSurrenderAnswer(c);
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
