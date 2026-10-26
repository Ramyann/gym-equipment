import { cleanDocument, validateTimeline, type TimelineData } from './history.ts';
import type { RackDoc } from "../../rack-generator/types.ts";
import { validateProjectRooms, type ProjectRoom, type ProjectType } from './space-projects.ts';
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface SavedConfig {
  id: string;
  name: string;
  doc: RackDoc;
  timeline?: TimelineData;
  projectType?: ProjectType;
  rooms?: ProjectRoom[];
  activeRoomId?: string;
  gym?: { type: 'home' | 'commercial'; client: string; createdAt: number; updatedAt: number };
}
export interface ConfigCollection {
  configs: SavedConfig[];
  activeId: string | null;
  draft: RackDoc | null;
  draftTimeline?: TimelineData;
}
/** Async boundary: a database adapter can replace browser storage without changing consumers. */
export interface ConfigStorage {
  read(): Promise<ConfigCollection>;
  write(value: ConfigCollection): Promise<void>;
  /** Browser storage can commit before pagehide returns; remote adapters remain asynchronous. */
  writeNow?(value: ConfigCollection): void;
}
export const CONFIG_KEY = "bos-strength-configurations-v1";
export class LocalConfigStorage implements ConfigStorage {
  constructor(private storage?: StorageLike) {}
  async read(): Promise<ConfigCollection> {
    const raw = this.storage?.getItem(CONFIG_KEY);
    if (!raw) {
      const legacy = this.storage?.getItem("bos-strength-assembly-v1");
      const result: ConfigCollection = {
        configs: legacy
          ? [
              {
                id: "legacy",
                name: "Imported rack",
                doc: cleanDocument(JSON.parse(legacy)),
              },
            ]
          : [],
        activeId: legacy ? "legacy" : null,
        draft: null,
      };
      // Migrate on the first successful write, so full storage cannot prevent
      // opening/exporting the original single-slot document.
      return result;
    }
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== "object" ||
      !("configs" in value) ||
      !Array.isArray(value.configs)
    )
      throw new Error("Invalid saved configurations");
    if ("version" in value && value.version !== 2) throw new Error("Unsupported configuration collection version");
    const data = value as ConfigCollection;
    const ids = new Set<string>();
    const configs = data.configs.map((config) => {
      if (
        !config ||
        typeof config.id !== "string" ||
        ids.has(config.id) ||
        typeof config.name !== "string" ||
        !config.name.trim()
      )
        throw new Error("Invalid configuration");
      ids.add(config.id);
      const gym = config.gym;
      if (config.projectType !== undefined && !['home', 'apartment', 'gym'].includes(config.projectType)) throw Error('Invalid project type');
      const projectRooms = validateProjectRooms(config);
      if (gym && (!['home', 'commercial'].includes(gym.type) || typeof gym.client !== 'string' || !Number.isFinite(gym.createdAt) || !Number.isFinite(gym.updatedAt))) throw new Error('Invalid gym details');
      return {
        id: config.id,
        name: config.name,
        doc: cleanDocument(config.doc),
        ...(gym ? { gym: { ...gym } } : {}),
        ...(config.projectType ? { projectType: config.projectType } : {}),
        ...projectRooms,
        ...(config.timeline !== undefined ? { timeline: validateTimeline(config.timeline, cleanDocument(config.doc)) } : {}),
      };
    });
    return {
      configs,
      activeId: configs.some((c) => c.id === data.activeId)
        ? data.activeId
        : null,
      draft: data.draft ? cleanDocument(data.draft) : null,
      ...(data.draftTimeline !== undefined ? { draftTimeline: validateTimeline(data.draftTimeline, cleanDocument(data.draft)) } : {}),
    };
  }
  async write(value: ConfigCollection) {
    this.writeNow(value);
  }
  writeNow(value: ConfigCollection) {
    if (!this.storage)
      throw new Error(
        "Browser storage is unavailable. Export your design as JSON."
      );
    this.storage.setItem(CONFIG_KEY, JSON.stringify({ ...value, version: 2 }));
  }
}
