import { init } from "@instantdb/react";
import schema from "../instant.schema";

// ID for app: contract-whist-scoreboard
const APP_ID = "33fdf866-9fcb-4721-a84d-ca1dba1f0ab0";

export const db = init({ appId: APP_ID, schema });

export type DB = typeof db;
