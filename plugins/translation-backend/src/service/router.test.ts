// createRouter.test.ts
import request from "supertest";
import express from "express";
import fs from "fs";
import path from "path";
import { createRouter } from "./router";

jest.mock("fs");

describe("createRouter", () => {
  let app: express.Express;

  beforeAll(async () => {
    const router = await createRouter();
    app = express();
    app.use("/", router);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it("should return 200 and JSON content when file exists", async () => {
    const mockFilePath = "/tmp/en.json";
    const resolvedPath = path.resolve(mockFilePath);

    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue(
      JSON.stringify({ hello: "world" }),
    );

    const res = await request(app).get("/").query({ path: mockFilePath });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hello: "world" });
    expect(fs.existsSync).toHaveBeenCalledWith(resolvedPath);
    expect(fs.readFileSync).toHaveBeenCalledWith(resolvedPath, "utf-8");
  });

  it("should return 404 if file does not exist", async () => {
    const mockFilePath = "/tmp/missing.json";

    (fs.existsSync as jest.Mock).mockReturnValue(false);

    const res = await request(app).get("/").query({ path: mockFilePath });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: expect.stringContaining("File not found"),
    });
  });

  it("should return 500 if JSON is invalid", async () => {
    const mockFilePath = "/tmp/bad.json";

    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue("{ invalid json");

    const res = await request(app).get("/").query({ path: mockFilePath });

    expect(res.status).toBe(500);
    expect(res.body.error).toContain("Failed to read translation file");
  });

  it("should return 500 if fs.readFileSync throws an error", async () => {
    const mockFilePath = "/tmp/error.json";

    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockImplementation(() => {
      throw new Error("Error occured");
    });

    const res = await request(app).get("/").query({ path: mockFilePath });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe(
      "Failed to read translation file /tmp/error.json",
    );
  });
});
