import pino from "pino";
import { config } from "./config";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (config.NODE_ENV === "production" ? "info" : "debug"),
  transport:
    config.NODE_ENV === "production"
      ? undefined
      : { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss" } },
});
