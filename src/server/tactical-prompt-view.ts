import type { TacticalPromptView } from '../protocol/view.ts';
import { TacticalPromptKind, YES_NO_CHOICES } from '../sim/tactical/prompts.ts';
import { Team } from '../sim/tactical/soldier.ts';
import type { TacticalState } from '../sim/tactical/state.ts';

function itemName(t: TacticalState, item: number): string {
  return t.content.items.byIndex.get(item)?.name ?? String(item);
}

function disarmTrapView(t: TacticalState, id: string): TacticalPromptView {
  const trap = t.boobyTrap;
  const shownItem = !trap.buried && trap.item ? { item: itemName(t, trap.item.object.item) } : {};
  return {
    id,
    kind: 'disarmTrap',
    soldier: trap.soldier?.id ?? -1,
    gridNo: trap.gridNo,
    buried: trap.buried,
    ...shownItem,
    choices: [...YES_NO_CHOICES],
  };
}

function blueFlagView(t: TacticalState, id: string, kind: 'placeBlueFlag' | 'removeBlueFlag'): TacticalPromptView {
  const trap = t.boobyTrap;
  return { id, kind, soldier: trap.soldier?.id ?? -1, gridNo: trap.gridNo, choices: [...YES_NO_CHOICES] };
}

export function tacticalPromptView(t: TacticalState | null | undefined): TacticalPromptView | null {
  const prompt = t?.prompt;
  if (!t || !prompt) return null;
  switch (prompt.kind) {
    case TacticalPromptKind.DISARM_TRAP:
      return disarmTrapView(t, prompt.id);
    case TacticalPromptKind.ACTIVATE_SWITCH: {
      const ours = prompt.soldier.team === Team.OUR ? { soldier: prompt.soldier.id } : {};
      return { id: prompt.id, kind: 'activateSwitch', ...ours, choices: [...YES_NO_CHOICES] };
    }
    case TacticalPromptKind.PLACE_BLUE_FLAG:
    case TacticalPromptKind.REMOVE_BLUE_FLAG:
      return blueFlagView(t, prompt.id, prompt.kind);
  }
}
