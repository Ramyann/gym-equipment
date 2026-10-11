import {
  createRootRoute,
  createRoute,
  Outlet,
  Link,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";
/** Pages load lazily so the route table stays importable (and testable) without their CSS or workers. */
const rootRoute = createRootRoute({
  component: lazyRouteComponent(() => import('./WorkspaceShell.tsx')),
  notFoundComponent: () => (
    <main>
      <h1>Page not found</h1>
      <Link to="/">Open your workspace</Link>
    </main>
  ),
});
export const routeTree = rootRoute.addChildren([
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/account',
    component: lazyRouteComponent(() => import('./AccountPage.tsx')),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/builder.html",
    beforeLoad: ({ search }) => {
      throw redirect({ to: "/builder", search, replace: true });
    },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/parts.html",
    beforeLoad: () => {
      throw redirect({ to: "/library", replace: true });
    },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/index.html",
    beforeLoad: ({ search }) => {
      throw redirect({ to: Object.keys(search).length ? '/builder' : '/', search, replace: true });
    },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    beforeLoad: ({ search }) => {
      if (Object.keys(search).length) throw redirect({ to: '/builder', search, replace: true });
    },
    component: lazyRouteComponent(() => import("./DashboardPage.tsx")),
  }),
  // The editor has its own route; home is the saved-design dashboard.
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/builder",
    component: lazyRouteComponent(() => import("./BuilderPage.tsx")),
  }),
  // The library gallery is the part picker; a bare /parts has nothing to show.
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/parts",
    beforeLoad: () => {
      throw redirect({ to: "/library", replace: true });
    },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/parts/$partId",
    component: lazyRouteComponent(() => import("./PartsPage.tsx")),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/library",
    component: lazyRouteComponent(() => import("./LibraryPage.tsx")),
  }),
  // Pre-built gym gallery; legacy /?gym=<slug> links redirect to the editor.
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/gyms",
    component: lazyRouteComponent(() => import("./GymsPage.tsx")),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/gyms/$slug",
    component: lazyRouteComponent(() => import("./GymsPage.tsx"), "GymDetailPage"),
  }),
]);
