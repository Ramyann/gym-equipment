# Space Studio local MVP

Space Studio supports home, apartment, and gym projects using the existing private account workspace. It does not require AI credits for manual planning.

## Try it

1. Start the separate backend: `cd ../gym-studio-backend` then `npm run dev`. Start the frontend from this repository with `npm run dev`. Open http://127.0.0.1:5173.
2. Create a space, choose Home, Apartment, or Gym, set dimensions, and choose an empty or furnished starting point. Furnished layouts require at least 4 x 4 m.
3. Use **Rooms** in the builder to add, rename, position, switch, or remove rooms. Removal has an Undo action. Each room keeps its own items and editing history.
4. Use **Add item > Furniture & home essentials** for a table, chair, sofa, bed, bookshelf, wardrobe, refrigerator, or lamp. Use the library to customize and save reusable versions. Every item uses editable shapes; no provider request is made.
5. In the component editor, change shape, size, position, rotation, or color; add/remove components (maximum 24). In the library, Save & use in space lets you choose both a project and a destination room.
6. Use the Room panel for dimensions, wall/floor finishes, doors, and windows. Confirm opening placement in the builder and select it to adjust measurements.
7. The Rooms dialog exports a floor-plan SVG and a whole-project JSON backup. Dashboard **Import project** validates and restores that JSON as a new independent project. The existing builder JSON/GLB/3MF exporters apply to the current room; use the whole-project backup to preserve all rooms.
8. Sign in for private backend saving. Wait for **Saved to cloud** before signing out. Account workspace backup also preserves projects and library items.

## Project-specific items

Home and apartment builders open the furniture collection and hide training equipment and rack tools. Gym builders show gym equipment. Shared room decor and basic shapes remain available in both. Recent and favourite stock items respect the active project type.

The library follows the active project, with an **Items for** dropdown to browse Home, Apartment, Gym or all project types. In the custom-item editor, **Use for** saves an item's classification as Homes & apartments, Gyms or All spaces. **Save & use in space** lists compatible destination projects and lets you choose a room. Older items use their catalog category or recognizable name; unclassified component models remain usable in all spaces. Classification never removes an item already placed in a saved project.

For server deployment, operational checks and backup recovery, see the sibling backend's `docs/production-readiness.md`.

## Data and compatibility

SavedConfig adds optional projectType, rooms, and activeRoomId. Each room contains an ID, name, plan position in millimeters, RackDoc, and optional editing timeline. The legacy doc/timeline projection always mirrors the active room. Legacy gyms remain readable and acquire room metadata when rooms are used. Room changes flush edits before switching. Project positions are bounded to 100 m and projects to 30 rooms.

Shared validators are copied into the separate backend with `npm run backend:sync`. Cloud requests validate room collections before accepting them; no database migration is required. Backend code, credentials, and local database files remain in the backend folder.

## Current limits

Rooms are rectangular, edited individually in 3D and displayed together on the 2D project plan. Room placement uses numeric center coordinates. Rooms can overlap; this is a planning tool, not an architectural CAD or construction-validation system. Shared walls, multi-floor buildings, irregular wall drawing, and whole-building 3D are not implemented. Furniture starters are simplified component models, not photorealistic vendor assets. Floor-plan SVG is a schematic; 3D model exports follow the existing export behavior and omit room scenery/finishes.

## Validation

`npm run build`, `npm run test:studio`, and `npm --prefix ../gym-studio-backend run build` check the frontend, shared contracts, account sync, and backend. Space-project regression tests cover furniture, per-room editing history, duplication, legacy upgrades, malformed collections, and storage reload. Backend tests verify private multi-room cloud saving across fresh login.
