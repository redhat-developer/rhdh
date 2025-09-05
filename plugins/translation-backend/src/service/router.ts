import express, { Router } from "express";
import fs from "fs";
import path from "path";

export async function createRouter(): Promise<Router> {

  const router = Router();
  router.use(express.json());
  router.get("/", (req, res) => {
    const filePath = req.query.path as string;

    try {
      const resolvedPath = path.resolve(filePath);
      if (!fs.existsSync(resolvedPath)) {
        res.status(404).json({ error: `File not found: ${resolvedPath}` });
        return;
      }

      const raw = fs.readFileSync(resolvedPath, "utf-8");
      const json = JSON.parse(raw);

      res.json(json);
    } catch (e) {
      res.status(500).json({
        error: `Failed to read translation file ${filePath}`,
        details: (e as Error).message,
      });
    }
  });

  return router;
}
