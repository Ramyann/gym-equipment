import { findCustomPart, saveCustomPart, type CustomPart } from '../state/custom-parts.ts';
import '../components/custom-parts.css';
import { UseEquipmentDialog } from '../components/UseEquipmentDialog.tsx';
import { hasVendorParameter, VendorParameter } from '../components/VendorParameter.tsx';
import { partAttribution } from '../../rack-generator/attribution.ts';
import { VendorCredit } from '../components/VendorControls.tsx';
import { ResetButton } from "../components/ResetButton.tsx";
import { NumericControl, type NumericControlProps } from "../components/NumericControl.tsx";
import { LatestRequest } from "../geometry/latest-request.ts";
import type { LibraryWorkerRequest } from "../../rack-generator/worker-types.ts";
import type { PartScene, View } from "../scenes/part-scene";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { createPartScene, download } from "../scenes/part-scene";
import "../../rack-generator/style.css";
import "../../rack-generator/library.css";
import "./studio-equipment-editor.css";
import type {
  CatalogDefinition,
  LibraryWorkerResponse,
} from "../../rack-generator/worker-types.ts";
type Definition = CatalogDefinition & { note?: string };
const labelOf = (key: string) =>
  key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
/** Long measurement ranges belong in one bounded input; named choices belong in a dropdown. */
function EquipmentParameter(props: NumericControlProps) {
  const options = props.standardOptions;
  if (!options || options.length <= 8) return <NumericControl {...props} />;
  if (options.every(option => /^-?[\d.]+\s*(mm|°)$/.test(option.label))) {
    const sorted = [...options].sort((a, b) => a.value - b.value);
    const nearest = (value: number) => sorted.reduce((best, option) => Math.abs(option.value - value) < Math.abs(best - value) ? option.value : best, sorted[0].value);
    return <NumericControl {...props} standardOptions={undefined} min={sorted[0].value} max={sorted.at(-1)!.value} step={sorted[1].value - sorted[0].value} normalize={nearest} showSlider={false} />;
  }
  return <><select aria-label={props.label} name={props.name} value={props.value} onChange={e => props.onValue(Number(e.target.value))}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ResetButton label={props.label} changed={props.value !== props.defaultValue} onReset={() => props.onValue(props.defaultValue!)} /></>;
}
export default function PartsPage() {
  const { partId } = useParams({ from: "/parts/$partId" }), navigate = useNavigate();
  const searchParams = useSearch({ strict: false }) as Record<string, unknown>;
  const customId = typeof searchParams.custom === 'string' ? searchParams.custom : null;
  const [usePart, setUsePart] = useState<CustomPart | null>(null);
  const [customName, setCustomName] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [savedId, setSavedId] = useState<string | null>(null);
  const loadedPreset = useRef<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const viewport = useRef<HTMLDivElement>(null),
    scene = useRef<PartScene | null>(null),
    worker = useRef<Worker | null>(null),
    requests = useRef<LatestRequest<LibraryWorkerRequest> | null>(null),
    sequence = useRef(0);
  const definitionsRef = useRef<Definition[]>([]),
    selectedRef = useRef<Definition | null>(null),
    values = useRef(new Map<string, Record<string, number>>());
  const compareRef = useRef({ enabled: false, overlay: false });
  const [definitions, setDefinitions] = useState<Definition[]>([]),
    [inputRevision, setInputRevision] = useState(0),
    [selected, setSelected] = useState<Definition | null>(null),
    [params, setParams] = useState<Record<string, number>>({});
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState("Initializing geometry…"),
    [error, setError] = useState(false),
    [valid, setValid] = useState(false),
    [description, setDescription] = useState("");
  const [view, setView] = useState<View>("iso"),
    [reference, setReference] = useState(false),
    [overlay, setOverlay] = useState(false),
    [wireframe, setWireframe] = useState(false);
  // Narrow screens: the part list is a drawer and the parameters a bottom sheet (CSS decides when they apply).
  const [drawer, setDrawer] = useState(false),
    [sheet, setSheet] = useState(false);
  const drawerToggle = useRef<HTMLButtonElement>(null),
    drawerClose = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!drawer) return;
    drawerClose.current?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setDrawer(false);
      drawerToggle.current?.focus();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [drawer]);
  const currentParams = useRef<Record<string, number>>({});
  function build(def: Definition, next: Record<string, number>) {
    values.current.set(def.id, next);
    setValid(false);
    setError(false);
    setStatus("Building " + def.name + "…");
    requests.current?.submit({
      id: ++sequence.current,
      part: def.id,
      params: next,
    });
  }
  function select(def: Definition, reset = false) {
    if (reset) setInputRevision(n => n + 1);
    const next = reset
      ? { ...def.defaults }
      : values.current.get(def.id) || { ...def.defaults };
    selectedRef.current = def;
    setSelected(def);
    setParams(next);
    build(def, next);
  }
  /** The URL owns the selection: catalog clicks push /parts/<id>, so back/forward step between parts. */
  useEffect(() => {
    if (!definitions.length) return;
    const def = definitions.find((d) => d.id === partId);
    if (def) {
      if (def.id !== selectedRef.current?.id || loadedPreset.current !== customId) {
        const preset = customId ? findCustomPart(customId) : undefined;
        if (preset?.part === def.id) values.current.set(def.id, { ...def.defaults, ...preset.params });
        loadedPreset.current = customId;
        setSavedId(preset?.part === def.id ? preset.id : null);
        setCustomName(preset?.part === def.id ? preset.name : def.name.replace(/^BOS STRENGTH\s*/, ''));
        setSaveMessage(previous => preset?.part === def.id ? previous || 'Saved in My custom equipment.' : customId && !preset ? 'This custom part could not be found.' : '');
        select(def);
      }
      return;
    }
    ++sequence.current;
    selectedRef.current = null;
    setSelected(null);
    setParams({});
    setValid(false);
    setDescription("");
    scene.current?.setMeshes([]);
    setError(true);
    setStatus(`No part called “${partId}”.`);
  }, [partId, definitions, customId]);
  useEffect(() => {
    if (!viewport.current) return;
    let active = true;
    const controller = createPartScene(viewport.current, (message) => {
      setError(true);
      setStatus(message);
    });
    scene.current = controller;
    const geometryWorker = new Worker(
      new URL("../../rack-generator/library-worker.ts", import.meta.url),
      { type: "module" }
    );
    worker.current = geometryWorker;
    requests.current = new LatestRequest(value => geometryWorker.postMessage(value));
    geometryWorker.onerror = (e) => {
      if (active) {
        setError(true);
        setStatus(e.message || "Could not initialize geometry engine.");
        setValid(false);
      }
    };
    geometryWorker.onmessage = ({
      data,
    }: MessageEvent<LibraryWorkerResponse>) => {
      if (!active) return;
      if (data.type === "catalog") {
        definitionsRef.current = data.definitions;
        setDefinitions(data.definitions);
        return;
      }
      requests.current?.complete();
      if (data.id !== sequence.current) return;
      if (data.type === "error") {
        setError(true);
        setStatus(data.error);
        setValid(false);
        return;
      }
      const size = controller.setMeshes(data.meshes);
      currentParams.current = data.params;
      setDescription(
        size.map(Math.round).join(" × ") + " mm"
      );
      setStatus(
        `${data.meshes.length} solids · ${data.meshes
          .reduce((n, m) => n + m.indices.length / 3, 0)
          .toLocaleString()} triangles`
      );
      setError(false);
      const invalid = !!form.current?.querySelector('[aria-invalid="true"]');
      setValid(!invalid);
      if (invalid) setStatus("Enter a valid number in every field.");
      void controller.compare(
        selectedRef.current?.reference,
        compareRef.current.enabled,
        compareRef.current.overlay
      );
    };
    return () => {
      active = false;
      ++sequence.current;
      geometryWorker.onmessage = null;
      geometryWorker.onerror = null;
      geometryWorker.terminate();
      requests.current?.clear();
      requests.current = null;
      worker.current = null;
      controller.dispose();
      scene.current = null;
    };
  }, []);
  function changeCompare(enabled: boolean, overlayValue: boolean) {
    setReference(enabled);
    setOverlay(overlayValue);
    compareRef.current = { enabled, overlay: overlayValue };
    void scene.current?.compare(selected?.reference, enabled, overlayValue);
  }
  function changeParam(key: string, value: number) {
    const next = { ...params, [key]: value };
    setParams(next);
    if (selected && Object.values(next).every(Number.isFinite)) build(selected, next);
    else { setValid(false); setStatus("Enter a valid parameter."); }
  }
  const categories = [...new Set(definitions.map((d) => d.category))],
    missing = definitions.length > 0 && !definitions.some((d) => d.id === partId);
  return (
    <div className={`parts-page${drawer ? " drawer-open" : ""}${sheet ? " sheet-open" : ""}`}>
      <div className="drawer-backdrop" aria-hidden="true" onClick={() => setDrawer(false)} />
      <aside id="parts-drawer" aria-label="Parts">
        <div className="eyebrow">
          BOS STRENGTH <span>02 / PARTS</span>
          <button ref={drawerClose} type="button" className="drawer-close" aria-label="Close parts list" onClick={() => { setDrawer(false); drawerToggle.current?.focus(); }}>
            ×
          </button>
        </div>
        <h1>Parts</h1>
        <p className="intro">
          <Link to="/library">← Equipment library</Link>
        </p>
        <Link className="source-link" to="/builder">
          Open gym builder ↗
        </Link>
        <input
          id="search"
          type="search"
          placeholder="Find a part…"
          aria-label="Find a part"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <nav id="catalog" aria-label="Parts library">
          {categories.map((category) => {
            const entries = definitions.filter(
              (d) =>
                d.category === category &&
                d.name.toLowerCase().includes(search.toLowerCase())
            );
            return entries.length ? (
              <div key={category}>
                <h3>{category}</h3>
                {entries.map((d) => (
                  <button
                    key={d.id}
                    className={partId === d.id ? "active" : ""}
                    aria-current={partId === d.id ? "page" : undefined}
                    onClick={() => {
                      setDrawer(false);
                      navigate({ to: "/parts/$partId", params: { partId: d.id } });
                    }}
                  >
                    {d.name}
                  </button>
                ))}
              </div>
            ) : null;
          })}
        </nav>
      </aside>
      <main>
        <header>
          <button
            ref={drawerToggle}
            type="button"
            className="drawer-toggle"
            aria-expanded={drawer}
            aria-controls="parts-drawer"
            onClick={() => setDrawer(true)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12" /></svg>
            Parts
          </button>
          <Link className="back-link" to="/library" search={(savedId ? { view: 'custom' } : {}) as never} aria-label="Equipment library">
            ← Library
          </Link>
          <div className="study-label">
            <span className="live-dot" /> EQUIPMENT STUDIO{" "}
            <span className="muted">/ CUSTOMIZE & SAVE</span>
          </div>
          <details className="header-actions studio-export"><summary>Export options</summary><div>
            <button
              id="save"
              disabled={!valid}
              onClick={() => {
                if (selected)
                  download(
                    new Blob(
                      [
                        JSON.stringify(
                          {
                            brand: partAttribution(selected.id)?.vendor ?? "BOS STRENGTH",
                            vendorAttribution: partAttribution(selected.id),
                            part: selected.id,
                            params: currentParams.current,
                            units: "mm",
                            approximate: true,
                          },
                          null,
                          2
                        ),
                      ],
                      { type: "application/json" }
                    ),
                    "bos-strength-" + selected.id + ".json"
                  );
              }}
              aria-label="Download parameters"
            >
              Download<span className="long"> parameters</span> ↓
            </button>
            <button
              id="export"
              disabled={!valid}
              onClick={() => {
                if (selected)
                  void scene.current
                    ?.exportGLB("bos-strength-" + selected.id)
                    .catch((e) => {
                      setError(true);
                      setStatus(String(e));
                    });
              }}
              aria-label="Export GLB"
            >
              <span className="long">Export </span>GLB ↓
            </button>
          </div></details>
        </header>
        <form className="custom-save" onSubmit={event => {
          event.preventDefault();
          if (!selected || !valid) return;
          try {
            const id = savedId ?? crypto.randomUUID();
            saveCustomPart({ ...(savedId ? findCustomPart(savedId) : undefined), id, name: customName, part: selected.id as import('../../rack-generator/types.ts').PartId,
              params: { ...currentParams.current }, defaults: { ...selected.defaults } });
            setSavedId(id);
            void navigate({ to: '/parts/$partId', params: { partId }, search: { custom: id } as never, replace: true });
            setSaveMessage(`Saved ${customName.trim()} to My custom equipment.`);
          } catch (error) { setSaveMessage(error instanceof Error ? error.message : 'Could not save custom part.'); }
        }}>
          <label htmlFor="custom-part-name">Equipment name</label>
          <input id="custom-part-name" value={customName} maxLength={120} required onChange={event => setCustomName(event.target.value)} />
          <button type="submit" disabled={!valid || !customName.trim()}>{savedId ? 'Save changes' : 'Save to my equipment'}</button>
          {savedId && <button type="button" disabled={!valid || !customName.trim()} onClick={() => {
            try {
              const id = crypto.randomUUID();
              saveCustomPart({ ...(savedId ? findCustomPart(savedId) : undefined), id, name: customName, part: selected!.id as import('../../rack-generator/types.ts').PartId,
                params: { ...currentParams.current }, defaults: { ...selected!.defaults } });
              setSavedId(id); void navigate({ to: '/parts/$partId', params: { partId }, search: { custom: id } as never, replace: true }); setSaveMessage('Saved a new copy of this custom part.');
            } catch (error) { setSaveMessage(String(error)); }
          }}>Save as new copy</button>}
          <button type="button" className="primary" disabled={!valid || !customName.trim()} onClick={() => {
            if (!selected) return;
            try {
              const preset: CustomPart = { ...(savedId ? findCustomPart(savedId) : undefined), id: savedId ?? crypto.randomUUID(), name: customName.trim(), part: selected.id as CustomPart['part'], params: { ...currentParams.current }, defaults: { ...selected.defaults } };
              saveCustomPart(preset); setSavedId(preset.id); setUsePart(preset); void navigate({ to: '/parts/$partId', params: { partId }, search: { custom: preset.id } as never, replace: true }); setSaveMessage('Saved to My custom equipment.');
            } catch (e) { setSaveMessage(String(e)); }
          }}>Save & use in gym</button>
          <p>Adjust the settings, give your equipment a name, then save it to reuse later.</p>
          {saveMessage && <p role="status">{saveMessage}</p>}
        </form>
        <div id="viewport" ref={viewport} aria-label="Interactive part viewer">
          <div className="view-tools">
            {(["iso", "front", "top", "side"] as const).map((v) => (
              <button
                key={v}
                data-view={v}
                className={view === v ? "selected" : ""}
                onClick={() => {
                  setView(v);
                  scene.current?.fit(v);
                }}
              >
                {v === "iso" ? "Perspective" : labelOf(v)}
              </button>
            ))}
          </div>
          <details className="display-tools"><summary>View options</summary><div>
            <label>
              <input
                id="reference"
                type="checkbox"
                checked={reference}
                disabled={!selected?.reference}
                onChange={(e) => changeCompare(e.target.checked, overlay)}
              />{" "}
              Compare source
            </label>
            <label>
              <input
                id="overlay"
                type="checkbox"
                checked={overlay}
                disabled={!selected?.reference}
                onChange={(e) =>
                  changeCompare(e.target.checked || reference, e.target.checked)
                }
              />{" "}
              Overlay
            </label>
            <label>
              <input
                id="wireframe"
                type="checkbox"
                checked={wireframe}
                onChange={(e) => {
                  setWireframe(e.target.checked);
                  scene.current?.setWireframe(e.target.checked);
                }}
              />{" "}
              Wireframe
            </label>
            <button id="fit" onClick={() => scene.current?.fit()}>
              Fit view ⤢
            </button>
          </div></details>
        <div className="model-caption">
          <h2 id="model-title">{selected?.name || (missing ? "" : "Loading parts…")}</h2>
          <p id="model-description">{description}</p>
        </div>
          <div id="compare-label" hidden={!reference || !selected?.reference}>
            {overlay
              ? "AMBER OVERLAY / ORIGINAL SOURCE"
              : "MANIFOLD REBUILD ←    → SOURCE MESH"}
          </div>
        </div>
        {missing && (
          <section className="part-missing" aria-labelledby="part-missing-title">
            <h2 id="part-missing-title">Part not found</h2>
            <p>
              There is no part called <code>{partId}</code>. Pick one of the{" "}
              {definitions.length} parts below or browse the{" "}
              <Link to="/library">parts library</Link>.
            </p>
            <ul>
              {definitions.map((d) => (
                <li key={d.id}>
                  <Link to="/parts/$partId" params={{ partId: d.id }}>{d.name}</Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        <footer>
          <span id="status" className={error ? "error" : ""} role="status">
            {status}
          </span>
        </footer>
      </main>
      <section id="editor" aria-label="Part parameters">
        <button
          type="button"
          id="sheet-toggle"
          aria-expanded={sheet}
          aria-controls="editor-body"
          onClick={() => setSheet(open => !open)}
        >
          <span className="sheet-grip" aria-hidden="true" />
          <span>Customize equipment</span>
          <small>{Object.keys(params).length || ""} {Object.keys(params).length === 1 ? "setting" : Object.keys(params).length ? "settings" : ""}</small>
          <span className="sheet-chevron" aria-hidden="true">⌃</span>
        </button>
        <div id="editor-body" className="editor-body">
        <div className="section-title">
          <span>Customize equipment</span>
          <small>MILLIMETRES / DEGREES</small>
        </div>
        <details className="equipment-info"><summary>About this equipment</summary>{selected && <VendorCredit part={selected.id} />}{selected?.description && <p id="part-note">{selected.description}</p>}</details>
        <form
          id="parameters"
          ref={form}
          key={inputRevision}
          onSubmit={(e) => {
            e.preventDefault();
            if (selected) build(selected, params);
          }}
        >
          <div id="fields" className="fields">
            {Object.entries(params).map(([key, value]) => (
              <label key={key}>
                {labelOf(key)}
                {selected && hasVendorParameter(selected.id,key) ? <VendorParameter name={key} label={labelOf(key)} value={value} defaultValue={selected.defaults[key]} onValue={next=>changeParam(key,next)}/> : <div className="input-wrap">
                  <EquipmentParameter defaultValue={selected?.defaults[key]} standardOptions={selected?.standardOptions?.[key]} key={`${selected?.id}:${key}`} name={key} label={labelOf(key)} value={value} step="any"

                    onInvalid={() => { ++sequence.current; setValid(false); setStatus("Enter a valid parameter."); }}
                    onValue={next => changeParam(key, next)} />
                  <span>
                    {selected?.standardOptions?.[key]?.length
                      ? selected.standardOptions[key].every(o => o.label.endsWith('mm')) ? 'mm' : selected.standardOptions[key].every(o => o.label.endsWith('°')) ? '°' : ''
                      : /angle/i.test(key) ? '°' : /segments|count/i.test(key) ? '' : 'mm'}
                  </span>
                </div>}
              </label>
            ))}
          </div>
          <button className="primary" type="submit" disabled={!selected}>
            Update preview <span>↗</span>
          </button>
        </form>
        <button
          id="reset"
          disabled={!selected}
          onClick={() => {
            if (selected) select(selected, true);
          }}
        >
          Reset to original
        </button>
        <a
          className="source-link"
          href={(selected && partAttribution(selected.id)?.url) || "https://strengthshop.eu/products/3d-rack-builder-riot-mrr-75"}
          target="_blank"
          rel="noreferrer"
        >
          Original reference ↗
        </a>
        </div>
      </section>
      {usePart && <UseEquipmentDialog part={usePart} close={() => setUsePart(null)} />}
    </div>
  );
}
