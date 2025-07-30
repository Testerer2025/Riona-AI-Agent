import dotenv from "dotenv";
import logger from "./config/logger";
import { shutdown } from "./services";
import app from "./app";
import { initAgent } from "./Agent/index";
import { connectDB } from "./config/db";  // ← HINZUFÜGEN

dotenv.config();

async function startServer() {
  try {
    // ✅ ZUERST MongoDB verbinden:
    await connectDB();
    logger.info("✅ Database connection established");
    
    // DANN den Agent initialisieren:
    await initAgent();
    logger.info("✅ Agent initialized");
    
  } catch (err) {
    logger.error("Error during startup:", err);
    process.exit(1);
  }

  const server = app.listen(process.env.PORT || 3000, () => {
    logger.info(`Server is running on port ${process.env.PORT || 3000}`);
  });

  process.on("SIGTERM", () => {
    logger.info("Received SIGTERM signal.");
    shutdown(server);
  });
  process.on("SIGINT", () => {
    logger.info("Received SIGINT signal.");
    shutdown(server);
  });
}

startServer();
