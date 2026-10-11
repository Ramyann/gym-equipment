import { workspaceStorage } from '../state/workspace-storage.ts';
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { loadGym, loadGyms } from "../gyms/gyms.ts";
import { gymPreviewUrl, sourceName, type GymEntry } from "../gyms/types.ts";
import { LocalConfigStorage } from '../state/config-storage.ts';
import { createGymFromTemplate } from '../state/gym-designs.ts';
import { StudioSidebar } from '../components/StudioSidebar.tsx';
import "../gyms/gyms.css";
import './dashboard.css';
import './studio-templates.css';

const GYM_RADAR = "https://gymradar.com";

function OpenInBuilder({ gym, className = "gym-open" }: { gym: GymEntry; className?: string }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function useTemplate() {
    setBusy(true); setError('');
    try {
      const repo = new LocalConfigStorage(workspaceStorage());
      const collection = await repo.read();
      const design = createGymFromTemplate(gym.doc, gym.title);
      await repo.write({ ...collection, configs: [...collection.configs, design], activeId: design.id });
      window.dispatchEvent(new Event('gym-designs-changed'));
      await navigate({ to: '/builder', search: { design: design.id } as never });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  }
  return (
    <div className="template-use"><button className={className} disabled={busy} onClick={() => void useTemplate()}>{busy ? 'Creating gym…' : 'Use template →'}</button>{error && <p role="alert" className="dashboard-error">{error}</p>}</div>
  );
}

function TemplatesLayout({ children }: { children: ReactNode }) {
  return <div className="studio-dashboard studio-templates"><StudioSidebar active="templates"/><main className="studio-main gyms-page"><div className="studio-breadcrumb">Workspace <span>/</span> <Link to="/gyms">Templates</Link></div>{children}</main></div>;
}

function OwnerCredit({ gym }: { gym: GymEntry }) {
  return (
    <p className="gym-credit">
      by <strong>{gym.owner}</strong> ·{" "}
      <a href={gym.sourceUrl} target="_blank" rel="noreferrer">
        on {sourceName(gym.sourceUrl)} ↗
      </a>
    </p>
  );
}

function Highlights({ gym }: { gym: GymEntry }) {
  return (
    <ul className="gym-highlights" aria-label="Highlights">
      {gym.highlights.map((highlight) => (
        <li key={highlight}>{highlight}</li>
      ))}
    </ul>
  );
}

/** Room footprint and piece counts, read straight off the document. */
function gymStats(gym: GymEntry) {
  const { room, floorItems = [], wallItems = [], hangItems = [], accessories } = gym.doc;
  const stats: string[] = [];
  if (room) {
    const m = (mm: number) => (mm / 1000).toFixed(1);
    stats.push(`${m(room.left + room.right)} × ${m(room.back + room.front)} m room`);
  }
  stats.push(`${accessories.length} rack attachments`);
  if (floorItems.length) stats.push(`${floorItems.length} floor pieces`);
  if (wallItems.length + hangItems.length) stats.push(`${wallItems.length + hangItems.length} on the walls`);
  return stats;
}

function useGyms() {
  const [gyms, setGyms] = useState<GymEntry[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    loadGyms().then(
      (loaded) => live && setGyms(loaded),
      (reason) => live && setError(String(reason)),
    );
    return () => {
      live = false;
    };
  }, []);
  return { gyms, error };
}

function PageHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="gyms-header">
      <div className="gyms-header-copy">
        <p className="eyebrow">FIND YOUR STARTING POINT</p>
        {children}
      </div>
      <nav>
        <Link to="/">My gym designs</Link>
      </nav>
    </header>
  );
}

export default function GymsPage() {
  const { gyms, error } = useGyms();
  const [query, setQuery] = useState('');
  const filtered = gyms?.filter(gym => `${gym.title} ${gym.summary} ${gym.equipment.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <TemplatesLayout>
      <PageHeader>
        <h1>Gym templates</h1>
        <p>
          Real home and garage gyms from{" "}
          <a href={GYM_RADAR} target="_blank" rel="noreferrer">
            Gym Radar
          </a>{" "}
          and gym tours. Choose a starting point, save your own copy, and make it yours.
        </p>
      </PageHeader>
      <div className="template-search"><label htmlFor="template-search">Find your inspiration</label><input id="template-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search gyms or equipment…"/></div>
      <p role="status" className="gyms-status">
        {error || (filtered ? `${filtered.length} templates` : "Loading templates…")}
      </p>
      <div className="gyms-grid">
        {filtered?.map((gym) => (
          <article className="gym-card" key={gym.slug}>
            <Link className="gym-card-image" to="/gyms/$slug" params={{ slug: gym.slug }} aria-label={`${gym.title} details`}>
              <img src={gymPreviewUrl(gym.slug)} alt={`3D render of ${gym.title}`} loading="lazy" width={1200} height={800} />
            </Link>
            <div className="gym-card-body">
              <h2>
                <Link to="/gyms/$slug" params={{ slug: gym.slug }}>
                  {gym.title}
                </Link>
              </h2>
              <OwnerCredit gym={gym} />
              <p className="gym-summary">{gym.summary}</p>
              <Highlights gym={gym} />
              <div className="gym-actions">
                <OpenInBuilder gym={gym} />
                <Link className="gym-details" to="/gyms/$slug" params={{ slug: gym.slug }}>
                  Equipment list
                </Link>
              </div>
            </div>
          </article>
        ))}
      </div>
      {filtered?.length === 0 && <div className="studio-empty"><h2>No templates match your search</h2><button className="secondary" onClick={() => setQuery('')}>Clear search</button></div>}
      <GalleryFooter />
    </TemplatesLayout>
  );
}

function GalleryFooter() {
  return (
    <footer className="gyms-footer">
      Gyms and equipment lists belong to their owners and are shared on{" "}
      <a href={GYM_RADAR} target="_blank" rel="noreferrer">
        Gym Radar
      </a>{" "}
      or in the owners' own tours. Previews are our own renders of each recreation; where a product isn't in our catalog, the closest match stands in.
    </footer>
  );
}

export function GymDetailPage() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const [gym, setGym] = useState<GymEntry | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setGym(undefined);
    loadGym(slug).then(
      (loaded) => live && setGym(loaded),
      () => live && setGym(null),
    );
    return () => {
      live = false;
    };
  }, [slug]);
  if (gym === undefined)
    return (
      <TemplatesLayout>
        <PageHeader />
        <p role="status" className="gyms-status">Loading gym…</p>
      </TemplatesLayout>
    );
  if (!gym)
    return (
      <TemplatesLayout>
        <PageHeader>
          <h1>Gym not found</h1>
          <p>
            There's no gym called “{slug}” in the gallery. <Link to="/gyms">See all gyms</Link>.
          </p>
        </PageHeader>
      </TemplatesLayout>
    );
  return (
    <TemplatesLayout>
      <PageHeader />
      <article className="gym-detail">
        <img className="gym-detail-image" src={gymPreviewUrl(gym.slug)} alt={`3D render of ${gym.title}`} width={1200} height={800} />
        <div className="gym-detail-body">
          <h1>{gym.title}</h1>
          <OwnerCredit gym={gym} />
          <p className="gym-summary">{gym.summary}</p>
          <Highlights gym={gym} />
          <p className="gym-stats">{gymStats(gym).join(" · ")}</p>
          <div className="gym-actions">
            <OpenInBuilder gym={gym} />
            <a className="gym-details" href={gym.sourceUrl} target="_blank" rel="noreferrer">
              See the real gym ↗
            </a>
          </div>
          <p className="gym-note">Creates your own saved gym with autosave. Your other designs and recovery draft stay in your workspace.</p>
        </div>
        <section className="gym-equipment" aria-labelledby="equipment-heading">
          <h2 id="equipment-heading">Equipment</h2>
          <ul>
            {gym.equipment.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </article>
      <GalleryFooter />
    </TemplatesLayout>
  );
}
