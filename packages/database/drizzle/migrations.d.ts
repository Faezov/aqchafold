declare const migrations: Parameters<
  typeof import("drizzle-orm/expo-sqlite/migrator").migrate
>[1];

export default migrations;
