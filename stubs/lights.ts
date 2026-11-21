import { writeLightTemplateFile } from '../src/content/formats/lht.ts';
import {
  editorLightIntensity,
  effectLightTemplateName,
  type LightTemplate,
  lightCreateOmni,
  mapLightTemplateName,
} from '../src/content/world/light-templates.ts';

const STUB_MAP_LIGHT_RADII = [1, 2, 3, 4, 5, 6, 7, 8];
const STUB_EFFECT_LIGHT_RADII = [0, 1, 2, 3, 4, 5, 6];
const EFFECT_LIGHT_STAND_IN_REACH = 4;

function editorLight(name: string, radius: number): LightTemplate {
  return lightCreateOmni(editorLightIntensity(radius), radius, name);
}

export function stubLightTemplates(): LightTemplate[] {
  return [
    ...STUB_MAP_LIGHT_RADII.map((radius) => editorLight(mapLightTemplateName(radius), radius)),
    ...STUB_EFFECT_LIGHT_RADII.map((radius) => editorLight(effectLightTemplateName(radius), radius + EFFECT_LIGHT_STAND_IN_REACH)),
  ];
}

export function stubLightTemplateFiles(): Map<string, Uint8Array> {
  return new Map(stubLightTemplates().map((t) => [t.name.toLowerCase(), writeLightTemplateFile(t)]));
}
