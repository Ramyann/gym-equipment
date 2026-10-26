import { useWorkspaceProjectType } from '../state/project-context.ts';
import { catalogPurpose, matchesPurpose, customFitsProject, type ItemContext } from '../state/item-purpose.ts';
import { StudioSidebar } from '../components/StudioSidebar.tsx';
import { FURNITURE_PRESETS, furniturePreset } from '../state/furniture-presets.ts';
import { saveCustomPart } from '../state/custom-parts.ts';
import { useNavigate } from '@tanstack/react-router';
import { useAccount } from '../cloud/session.ts';
import { useCustomParts, type CustomPart } from '../state/custom-parts.ts';
import { UseEquipmentDialog } from '../components/UseEquipmentDialog.tsx';
import { CustomParts } from '../components/CustomParts.tsx';
import { VendorCredit } from '../components/VendorControls.tsx';
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PartThumbnail } from "../components/PartThumbnail.tsx";
import { Link, useSearch } from "@tanstack/react-router";
import "../../rack-generator/library-gallery.css";
import "./dashboard.css";
import "./studio-library.css";
import type {
  CatalogDefinition,
  LibraryWorkerResponse,
} from "../../rack-generator/worker-types.ts";
type CatalogPart = CatalogDefinition & { note?: string };
/** Phones and small tablets (#215): the catalog is grouped into category sections, each showing a first few cards
 * until "Show all", so the page is a browsable index rather than 500 cards in one column of rows. */
const COMPACT = "(max-width: 900px)";
const PREVIEW = 4;
const sectionId = (category: string) => `library-${category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (notify) => {
      if (typeof matchMedia !== "function") return () => {};
      const list = matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => typeof matchMedia === "function" && matchMedia(query).matches,
    () => false,
  );
}
/** True once `ref` comes within a couple of screens of the viewport, then stays true: sections mount cards lazily. */
function useNearViewport(ref: React.RefObject<HTMLElement | null>) {
  const [near, setNear] = useState(() => typeof IntersectionObserver !== "function");
  useEffect(() => {
    if (near || !ref.current) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setNear(true); }, { rootMargin: "1200px 0px" });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [near, ref]);
  return near;
}
function PartCard({ part }: { part: CatalogPart }) {
  return (
    <Link className="gallery-card" to="/parts/$partId" params={{ partId: part.id }}>
      <PartThumbnail part={part.id} params={part.defaults} />
      <span className="gallery-category">{part.category}</span>
      <h2>{part.name}</h2>
      {/* Compact: the card is already a link, so the credit is text (no nested anchor). */}
      <VendorCredit part={part.id} compact />
      <span className="gallery-specs">
        {Object.entries(part.defaults)
          .filter(([key]) => ["height", "length", "width", "diameter"].includes(key))
          .slice(0, 3)
          .map(([key, value]) => `${key} ${Math.round(value)} mm`)
          .join(" · ")}
      </span>
      <strong>Customize →</strong>
    </Link>
  );
}
function LibrarySection({ category, parts, preview }: { category: string; parts: CatalogPart[]; preview: number }) {
  const ref = useRef<HTMLElement>(null), near = useNearViewport(ref);
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? parts : parts.slice(0, preview), hidden = parts.length - shown.length;
  return (
    <section ref={ref} className="library-section" id={sectionId(category)} aria-label={category}
      style={{ "--cards": shown.length } as React.CSSProperties}>
      <h2 className="library-section-title">{category} <span>{parts.length}</span></h2>
      {near ? (
        <div className="gallery-grid">
          {shown.map((part) => <PartCard key={part.id} part={part} />)}
        </div>
      ) : <div className="library-section-placeholder" aria-hidden="true" />}
      {hidden > 0 && (
        <button type="button" className="library-show-all" onClick={() => setExpanded(true)}>
          Show all {parts.length} · {category}
        </button>
      )}
    </section>
  );
}
/** Catalog metadata loads first; visible cards request geometry thumbnails lazily. */
export default function LibraryPage() {
  const navigate = useNavigate();
  const account = useAccount();
  const routeSearch = useSearch({ strict: false }) as Record<string, unknown>;
  const [view, setView] = useState<'collection' | 'custom'>(() => routeSearch.view === 'custom' ? 'custom' : 'collection');
  const [usePart, setUsePart] = useState<CustomPart | null>(null);
  const custom = useCustomParts();
  const activeType=useWorkspaceProjectType();
  const [contextOverride,setContextOverride]=useState<ItemContext|null>(null);
  const context=contextOverride??activeType, household=context==='home'||context==='apartment'||context==='all';
  const visibleCustom=custom.parts.filter(p=>customFitsProject(p,context));
  const [parts, setParts] = useState<CatalogPart[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All equipment");
  const [error, setError] = useState("");
  const compact = useMediaQuery(COMPACT);
  useEffect(() => {
    const worker = new Worker(
      new URL("../../rack-generator/library-worker.ts", import.meta.url),
      { type: "module" }
    );
    worker.onmessage = ({ data }: MessageEvent<LibraryWorkerResponse>) => {
      if (data.type === "catalog" && data.definitions) {
        const first = ['Benches', 'Dumbbells', 'Barbells', 'Kettlebells', 'Machines', 'Cardio', 'Floor storage', 'Custom templates'];
        const rank = (name: string) => { const index = first.indexOf(name); return index < 0 ? first.length : index; };
        setParts([...data.definitions].sort((a, b) => rank(a.category) - rank(b.category)));
        worker.terminate();
      }
    };
    worker.onerror = (event) =>
      setError(event.message || "Could not load the parts catalog.");
    return () => {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    };
  }, []);
  const contextualParts=parts.filter(p=>matchesPurpose(catalogPurpose(p.id,p.category),context));
  const categories = [
    "All equipment", ...(household?["Furniture", "Storage", "Appliances", "Lighting"]:[]),
    ...new Set(contextualParts.map((part) => part.category)),
  ];
  const matches = contextualParts.filter(
    (part) =>
      (category === "All equipment" || category === part.category) &&
      `${part.name} ${part.category}`
        .toLowerCase()
        .includes(search.toLowerCase())
  );
  const furnitureMatches = FURNITURE_PRESETS.filter(p=>household).filter(p => (category === 'All equipment' || p.category === category) && `${p.name} ${p.category}`.toLowerCase().includes(search.toLowerCase()));
  const totalMatches = matches.length + furnitureMatches.length;
  const grouped = new Map<string, CatalogPart[]>();
  for (const part of matches) {
    const list = grouped.get(part.category);
    if (list) list.push(part); else grouped.set(part.category, [part]);
  }
  const sections = [...grouped];
  function createFurniture(id: string) {
    try { const part=furniturePreset(id);saveCustomPart(part);void navigate({to:'/parts/$partId',params:{partId:part.part},search:{custom:part.id} as never}); }
    catch(e) {setError(e instanceof Error?e.message:String(e));}
  }
  return (
    <div className="studio-dashboard studio-library"><StudioSidebar active="equipment"/>
    <main className="studio-main library-gallery"><div className="studio-breadcrumb">Workspace <span>/</span> My library</div><header className="studio-heading"><div><h1>My library</h1><p>Furniture, appliances, and gym equipment. Customize items for every space.</p></div><details className="library-create-options"><summary>+ Create item</summary><div><p>Start with a simple shape and enter your measurements.</p>{[['template-assembly','Component model'],['template-bench','Bench'],['template-machine','Strength machine'],['template-storage','Storage rack'],['template-cardio','Cardio machine'],['template-block','Box or platform'],['template-disc','Disc, cylinder or ball']].filter(([id])=>matchesPurpose(catalogPurpose(id),context)).map(([id, name]) => <Link key={id} to="/parts/$partId" params={{ partId: id }}>{name} →</Link>)}</div></details></header>
      {view === 'collection' && <section className="library-welcome"><div><span className="eyebrow">YOUR ITEM WORKSPACE</span><h2>Build a collection that fits your space</h2><p>Choose an item, adjust its dimensions and options, then save your own version. Reuse it in any of your projects.</p><button type="button" onClick={() => { setView('custom'); setSearch(''); }}>View my custom equipment →</button></div><div className="library-workflow"><span><b>1</b> Choose an item</span><span><b>2</b> Customize & save</span><span><b>3</b> Use in your space</span></div></section>}
      <div className="library-tabs" role="group" aria-label="Equipment library views"><button type="button" aria-pressed={view === 'collection'} onClick={() => setView('collection')}>Item collection <span>{contextualParts.length + (household?FURNITURE_PRESETS.length:0)}</span></button><button type="button" aria-pressed={view === 'custom'} onClick={() => setView('custom')}>My custom items <span>{visibleCustom.length}</span></button></div>
      <div className="library-context"><label>Items for<select aria-label="Items for" value={context} onChange={e=>{setContextOverride(e.target.value as ItemContext);setCategory('All equipment');setSearch('');}}><option value="home">Home</option><option value="apartment">Apartment</option><option value="gym">Gym</option><option value="all">All project types</option></select></label><p>{contextOverride?'Browsing your chosen collection.':'Matched to your active project.'} {household?'Furniture, appliances, and household decor.':'Training equipment and gym essentials.'}</p></div>
      <div className="gallery-filters">
        <label>
          Search items
          <input
            type="search"
            placeholder="Search furniture, appliances, equipment…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {view === 'collection' && <label>
          Category
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            {categories.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>}
        <span role="status">
          {view === 'custom' ? `${visibleCustom.length} saved ${visibleCustom.length === 1 ? 'item' : 'items'}` : error ||
            (parts.length ? `${totalMatches} ${totalMatches === 1 ? 'item' : 'items'}` : "Loading catalog…")}
        </span>
        {view === 'collection' && sections.length > 1 && (
          <nav className="library-sections" aria-label="Sections">
            {sections.map(([name, list]) => (
              <a key={name} href={`#${sectionId(name)}`} onClick={(event) => {
                event.preventDefault();
                const target = document.getElementById(sectionId(name));
                // Land the heading just under the sticky search and section bar.
                const bar = event.currentTarget.closest<HTMLElement>(".gallery-filters")?.getBoundingClientRect().height ?? 0;
                if (target) scrollTo({ top: target.getBoundingClientRect().top + scrollY - bar - 12 });
              }}>{name} <span>{list.length}</span></a>
            ))}
          </nav>
        )}
      </div>
      {view === 'collection'&&household&&<section className="library-section furniture-starters" aria-label="Furniture and home essentials"><h2>Furniture & home essentials</h2><p>Start with an editable item. Adjust every shape, size, and color, then reuse it in any space. No AI needed.</p><div className="furniture-category-tabs">{['All','Furniture','Storage','Appliances','Lighting'].map(name=><button key={name} type="button" aria-pressed={category===name||(name==='All'&&category==='All equipment')} onClick={()=>setCategory(name==='All'?'All equipment':name)}>{name}</button>)}</div><div className="furniture-starter-grid">{furnitureMatches.map(p=><button key={p.id} onClick={()=>createFurniture(p.id)}><PartThumbnail part="template-assembly" params={furniturePreset(p.id,p.id).params}/><strong>{p.name}</strong><small>{p.category} · Customize →</small></button>)}</div></section>}
      {view === 'custom' ? <CustomParts context={context} query={search} onAdd={setUsePart} addLabel="Use in space" onBrowse={() => { setView('collection'); setSearch(''); }} /> : <>
      {sections.map(([name, list]) => (
        <LibrarySection key={name} category={name} parts={list}
          preview={!search.trim() && category === "All equipment" ? (compact ? PREVIEW : 6) : Infinity} />
      ))}
      {!totalMatches && parts.length > 0 && (
<div className="library-empty"><h2>No items found</h2><p>Try another name or browse the full collection.</p><button type="button" onClick={() => { setSearch(''); setCategory('All equipment'); }}>Reset search & category</button></div>
      )}
      </>}
      <p className="library-storage-note">{account.session ? 'Custom equipment saves locally and syncs to your account.' : 'Custom equipment is saved in this browser.'} Adding it to a space creates an independent copy.</p>
    </main>{usePart && <UseEquipmentDialog part={usePart} close={() => setUsePart(null)} />}</div>
  );
}
