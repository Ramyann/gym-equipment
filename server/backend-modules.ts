import express, { type Request, type Response, type NextFunction } from 'express';
import { All, Controller, Inject, Module, Next, Req, Res, type DynamicModule } from '@nestjs/common';
import { createStudioApi, type StudioOptions } from './studio-api.ts';
import { mountPartsApi } from './parts-api.ts';
import type { Database } from './studio-db.ts';

/** Nest controllers delegate to the tested account/geometry services with their existing API contract. */
const OPTIONS = Symbol('studio-options'), DB = Symbol('database'), SETTINGS = Symbol('equipment-settings');
class AccountsController {
  private readonly routes;
  constructor(options: StudioOptions) { this.routes = createStudioApi(options); }
  dispatch(request: Request, response: Response, next: NextFunction) { this.routes(request, response, next); }
}
Inject(OPTIONS)(AccountsController, undefined, 0);
Controller()(AccountsController);
All('api/studio/{*path}')(AccountsController.prototype, 'dispatch', Object.getOwnPropertyDescriptor(AccountsController.prototype, 'dispatch')!);
Req()(AccountsController.prototype, 'dispatch', 0); Res()(AccountsController.prototype, 'dispatch', 1); Next()(AccountsController.prototype, 'dispatch', 2);

class EquipmentController {
  private readonly routes = express();
  constructor(db: Database, settings: { siteUrl: string; env: Record<string, string | undefined> }) { mountPartsApi(this.routes, db, settings.siteUrl, settings.env); }
  dispatch(request: Request, response: Response, next: NextFunction) { this.routes(request, response, next); }
}
Inject(DB)(EquipmentController, undefined, 0); Inject(SETTINGS)(EquipmentController, undefined, 1);
Controller()(EquipmentController);
All('api/{*path}')(EquipmentController.prototype, 'dispatch', Object.getOwnPropertyDescriptor(EquipmentController.prototype, 'dispatch')!);
Req()(EquipmentController.prototype, 'dispatch', 0); Res()(EquipmentController.prototype, 'dispatch', 1); Next()(EquipmentController.prototype, 'dispatch', 2);

class AccountsModule {}
Module({})(AccountsModule);
class EquipmentModule {}
Module({})(EquipmentModule);
class BackendModule {}
Module({})(BackendModule);
export function backendModule(options: StudioOptions, env: Record<string, string | undefined>, shutdown: () => Promise<void>): DynamicModule {
  return { module: BackendModule, imports: [
    { module: AccountsModule, controllers: [AccountsController], providers: [{ provide: OPTIONS, useValue: options }] },
    { module: EquipmentModule, controllers: [EquipmentController], providers: [{ provide: DB, useValue: options.db }, { provide: SETTINGS, useValue: { siteUrl: options.siteUrl, env } }] },
  ], providers: [{ provide: 'database-lifecycle', useValue: { onApplicationShutdown: shutdown } }] };
}
