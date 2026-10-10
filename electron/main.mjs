import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from "electron";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import readline from "node:readline";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resourceRoot = app.isPackaged
  ? path.join(process.resourcesPath, "app.asar.unpacked")
  : rootDirectory;
const APP_ID = "local.amiya.desktop.pet";
const APP_ICON_PATH = path.join(rootDirectory, "assets", "amiya-app-icon.png");
const ALWAYS_ON_TOP_LEVEL = process.platform === "win32" ? "screen-saver" : "floating";
const BASE_WIDTH = 420;
const BASE_HEIGHT = 500;
const GRAVITY = 1850;
const WALK_SPEED = 34;
const WALK_ACCELERATION = 5.5;
const WINDOW_SNAP_ABOVE = 20;
const WINDOW_SNAP_BELOW = 48;
const SURFACE_SIT_LIFT_RATIO = 0.14;

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

let mainWindow;
let tray;
let monitorProcess;
let desktopWindows = [];
let physicsTimer;
let dragTimer;
let floatingPosition = { x: 0, y: 0 };
let verticalVelocity = 0;
let horizontalVelocity = 0;
let walking = false;
let direction = -1;
let dragging = false;
let gravityEnabled = true;
let edgeSnapEnabled = true;
let alwaysOnTop = true;
let voiceEnabled = true;
let petScale = 0.6;
let supportRatio = 1;
let groundedWindow;
let lastPhysicsTime = performance.now();
let monitorSampleLogged = false;

function sendCommand(command) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("pet:command", command);
}

function getPetDimensions() {
  return {
    width: Math.round(BASE_WIDTH * petScale),
    height: Math.round(BASE_HEIGHT * petScale)
  };
}

function applyPetBounds(x, y) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const { width, height } = getPetDimensions();
  mainWindow.setBounds({ x: Math.round(x), y: Math.round(y), width, height }, false);
}

function applyAlwaysOnTop() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setAlwaysOnTop(alwaysOnTop, ALWAYS_ON_TOP_LEVEL);
  if (alwaysOnTop && mainWindow.isVisible()) mainWindow.moveTop();
}

function createTrayIcon() {
  const appIcon = nativeImage.createFromPath(APP_ICON_PATH);
  if (!appIcon.isEmpty()) return appIcon.resize({ width: 32, height: 32 });

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="9" fill="#202638"/>
      <path d="M8 25 14.1 7h3.8L24 25h-4l-1.2-4H13l-1.2 4H8Zm6-7h4l-2-6.5L14 18Z" fill="#f2bace"/>
    </svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
}

function setPetScale(nextScale) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  petScale = nextScale;
  const oldBounds = mainWindow.getBounds();
  const { width: nextWidth, height: nextHeight } = getPetDimensions();
  const centerX = oldBounds.x + oldBounds.width / 2;
  const bottom = oldBounds.y + oldBounds.height;
  const nextX = Math.round(centerX - nextWidth / 2);
  const nextY = Math.round(
    groundedWindow ? groundedWindow.Y - getSurfaceSupportOffset(nextHeight) : bottom - nextHeight
  );
  applyPetBounds(nextX, nextY);
  floatingPosition = { x: nextX, y: nextY };
  sendCommand({ type: "scale", value: petScale });
}

function buildMenu() {
  const visible = Boolean(mainWindow?.isVisible());
  return Menu.buildFromTemplate([
    {
      label: visible ? "隐藏阿米娅" : "显示阿米娅",
      click: () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible()) mainWindow.hide();
        else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: "separator" },
    {
      label: "更改动作",
      submenu: [
        { label: "待机", click: () => sendCommand({ type: "action", action: "idle" }) },
        { label: "行走", click: () => sendCommand({ type: "action", action: "walk" }) },
        { label: "坐下", click: () => sendCommand({ type: "action", action: "sit" }) },
        { label: "躺下", click: () => sendCommand({ type: "action", action: "sleep" }) },
        { label: "戳一戳", click: () => sendCommand({ type: "action", action: "touch" }) }
      ]
    },
    {
      label: "大小",
      submenu: [
        [0.4, "40%（很小）"],
        [0.5, "50%"],
        [0.6, "60%（默认）"],
        [0.7, "70%"],
        [0.8, "80%"],
        { type: "separator" },
        {
          label: "自定义大小…",
          click: () => sendCommand({ type: "open-size-dialog", current: petScale })
        }
      ].map((item) => {
        if (!Array.isArray(item)) return item;
        const [scale, label] = item;
        return {
          label,
          type: "radio",
          checked: petScale === scale,
          click: () => setPetScale(scale)
        };
      })
    },
    {
      label: "日语语音与中文字幕",
      type: "checkbox",
      checked: voiceEnabled,
      click: (item) => {
        voiceEnabled = item.checked;
        sendCommand({ type: "voice-enabled", enabled: voiceEnabled });
      }
    },
    { type: "separator" },
    {
      label: "重力系统",
      type: "checkbox",
      checked: gravityEnabled,
      click: (item) => {
        gravityEnabled = item.checked;
        verticalVelocity = 0;
      }
    },
    {
      label: "吸附软件窗口上沿",
      type: "checkbox",
      checked: edgeSnapEnabled,
      click: (item) => {
        edgeSnapEnabled = item.checked;
      }
    },
    {
      label: "始终置顶",
      type: "checkbox",
      checked: alwaysOnTop,
      click: (item) => {
        alwaysOnTop = item.checked;
        applyAlwaysOnTop();
      }
    },
    { type: "separator" },
    { label: "退出", click: () => app.quit() }
  ]);
}

function showPetMenu() {
  buildMenu().popup({ window: mainWindow });
}

function startWindowMonitor() {
  if (process.platform !== "win32") return;
  const scriptPath = path.join(resourceRoot, "electron", "window-monitor.ps1");
  monitorProcess = spawn(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-ExcludePid", String(process.pid)],
    { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }
  );

  const lines = readline.createInterface({ input: monitorProcess.stdout });
  lines.on("line", (line) => {
    try {
      const parsed = JSON.parse(line);
      desktopWindows = Array.isArray(parsed) ? parsed : [];
      if (process.env.PET_CAPTURE_PATH && !monitorSampleLogged) {
        monitorSampleLogged = true;
        console.log(`[pet] window monitor found ${desktopWindows.length} candidate windows`);
      }
    } catch {
      // Ignore a partial monitor sample; the next sample replaces it.
    }
  });
}

function horizontalOverlap(left, width, rect) {
  return Math.max(0, Math.min(left + width, rect.X + rect.Width) - Math.max(left, rect.X));
}

function getSurfaceSupportOffset(height) {
  if (supportRatio >= 0.98) return height;
  return Math.min(height, height * (supportRatio + SURFACE_SIT_LIFT_RATIO));
}

function findLandingWindow(bounds, previousSupport, proposedSupport, workArea) {
  let bestWindow;
  if (!edgeSnapEnabled) return undefined;

  for (const rect of desktopWindows) {
    if (rect.Width <= 0 || rect.Height <= 0) continue;
    if (horizontalOverlap(floatingPosition.x, bounds.width, rect) < Math.min(70, bounds.width * 0.22)) continue;
    const top = rect.Y;
    if (top <= workArea.y + 35 || top >= workArea.y + workArea.height) continue;

    const crossingSurface = previousSupport <= top && proposedSupport >= top;
    const insideSnapBand =
      previousSupport >= top - WINDOW_SNAP_ABOVE && previousSupport <= top + WINDOW_SNAP_BELOW;
    if ((crossingSurface || insideSnapBand) && (!bestWindow || top < bestWindow.Y)) bestWindow = rect;
  }

  return bestWindow;
}

function reverseDirection() {
  direction = direction === 1 ? -1 : 1;
  mainWindow?.webContents.send("pet:direction", direction);
}

function updatePhysics() {
  if (!mainWindow || mainWindow.isDestroyed() || dragging || !mainWindow.isVisible()) {
    lastPhysicsTime = performance.now();
    return;
  }

  const now = performance.now();
  const deltaTime = Math.min((now - lastPhysicsTime) / 1000, 0.05);
  lastPhysicsTime = now;
  const currentBounds = mainWindow.getBounds();
  const dimensions = getPetDimensions();
  const bounds = { ...currentBounds, ...dimensions };
  const workArea = screen.getDisplayMatching(bounds).workArea;

  if (groundedWindow) {
    groundedWindow =
      desktopWindows.find(
        (candidate) => candidate.Pid === groundedWindow.Pid && candidate.Title === groundedWindow.Title
      ) ?? groundedWindow;
    const groundedOverlap = horizontalOverlap(floatingPosition.x, bounds.width, groundedWindow);
    if (groundedOverlap >= Math.min(70, bounds.width * 0.22)) {
      floatingPosition.y = groundedWindow.Y - getSurfaceSupportOffset(bounds.height);
      verticalVelocity = 0;
    } else {
      groundedWindow = undefined;
    }
  }

  if (groundedWindow) {
    const centerX = floatingPosition.x + bounds.width / 2;
    const edgeMargin = Math.max(18, bounds.width * 0.16);
    if (walking && direction < 0 && centerX <= groundedWindow.X + edgeMargin) reverseDirection();
    if (walking && direction > 0 && centerX >= groundedWindow.X + groundedWindow.Width - edgeMargin) reverseDirection();
  }

  const targetHorizontalVelocity = walking ? WALK_SPEED * direction : 0;
  const velocityBlend = Math.min(1, WALK_ACCELERATION * deltaTime);
  horizontalVelocity += (targetHorizontalVelocity - horizontalVelocity) * velocityBlend;
  if (!walking && Math.abs(horizontalVelocity) < 0.35) horizontalVelocity = 0;
  floatingPosition.x += horizontalVelocity * deltaTime;

  const minimumX = workArea.x;
  const maximumX = workArea.x + workArea.width - bounds.width;
  if (floatingPosition.x <= minimumX) {
    floatingPosition.x = minimumX;
    horizontalVelocity = 0;
    if (walking && direction < 0) reverseDirection();
  } else if (floatingPosition.x >= maximumX) {
    floatingPosition.x = maximumX;
    horizontalVelocity = 0;
    if (walking && direction > 0) reverseDirection();
  }

  if (gravityEnabled) {
    verticalVelocity += GRAVITY * deltaTime;
    const supportOffset = getSurfaceSupportOffset(bounds.height);
    const previousSupport = floatingPosition.y + supportOffset;
    const proposedY = floatingPosition.y + verticalVelocity * deltaTime;
    const proposedSupport = proposedY + supportOffset;
    const landingWindow = findLandingWindow(bounds, previousSupport, proposedSupport, workArea);
    const floorTop = workArea.y + workArea.height;
    const floorSupportOffset = supportOffset;
    const proposedFloorSupport = proposedY + floorSupportOffset;

    if (landingWindow) {
      floatingPosition.y = landingWindow.Y - supportOffset;
      groundedWindow = landingWindow;
      verticalVelocity = 0;
    } else if (proposedFloorSupport >= floorTop) {
      floatingPosition.y = floorTop - floorSupportOffset;
      groundedWindow = undefined;
      verticalVelocity = 0;
    } else {
      floatingPosition.y = proposedY;
      groundedWindow = undefined;
    }
  }

  const floorSupportOffset = gravityEnabled ? getSurfaceSupportOffset(bounds.height) : bounds.height;
  const maximumY = workArea.y + workArea.height - floorSupportOffset;
  const visibleHeightAtTop = gravityEnabled
    ? Math.min(24, bounds.height * 0.1)
    : bounds.height * 0.4;
  const minimumY = workArea.y - bounds.height + visibleHeightAtTop;
  floatingPosition.y = Math.max(minimumY, Math.min(maximumY, floatingPosition.y));
  applyPetBounds(floatingPosition.x, floatingPosition.y);
}

function startDragging() {
  if (!mainWindow || dragging) return;
  dragging = true;
  walking = false;
  verticalVelocity = 0;
  horizontalVelocity = 0;
  const cursor = screen.getCursorScreenPoint();
  let previousCursorX = cursor.x;
  const bounds = mainWindow.getBounds();
  const offset = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };

  dragTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const point = screen.getCursorScreenPoint();
    const horizontalDelta = point.x - previousCursorX;
    if (Math.abs(horizontalDelta) >= 2) {
      direction = horizontalDelta < 0 ? -1 : 1;
      mainWindow.webContents.send("pet:direction", direction);
    }
    previousCursorX = point.x;
    floatingPosition = { x: point.x - offset.x, y: point.y - offset.y };
    applyPetBounds(floatingPosition.x, floatingPosition.y);
  }, 16);
}

function stopDragging() {
  if (!dragging) return;
  dragging = false;
  clearInterval(dragTimer);
  dragTimer = undefined;
  verticalVelocity = 0;
  groundedWindow = undefined;
  if (mainWindow && !mainWindow.isDestroyed()) {
    const bounds = mainWindow.getBounds();
    floatingPosition = { x: bounds.x, y: bounds.y };
  }
}

function createWindow() {
  const workArea = screen.getPrimaryDisplay().workArea;
  const { width, height } = getPetDimensions();

  mainWindow = new BrowserWindow({
    width,
    height,
    x: workArea.x + workArea.width - width - 30,
    y: workArea.y + workArea.height - height,
    minWidth: Math.round(BASE_WIDTH * 0.3),
    minHeight: Math.round(BASE_HEIGHT * 0.3),
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    resizable: false,
    alwaysOnTop,
    skipTaskbar: true,
    hasShadow: false,
    title: "阿米娅桌宠",
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(rootDirectory, "electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  floatingPosition = { x: mainWindow.getBounds().x, y: mainWindow.getBounds().y };
  applyAlwaysOnTop();

  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl) void mainWindow.loadURL(developmentUrl);
  else void mainWindow.loadFile(path.join(rootDirectory, "dist", "index.html"));

  mainWindow.on("show", () => {
    const bounds = mainWindow.getBounds();
    floatingPosition = { x: bounds.x, y: bounds.y };
    applyAlwaysOnTop();
  });

  mainWindow.on("restore", applyAlwaysOnTop);

  mainWindow.webContents.once("did-finish-load", () => {
    if (!process.env.PET_CAPTURE_PATH && !process.env.PET_CAPTURE_SERIES_DIR) return;
    setTimeout(async () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (process.env.PET_CAPTURE_SERIES_DIR) {
        const { mkdir, writeFile } = await import("node:fs/promises");
        await mkdir(process.env.PET_CAPTURE_SERIES_DIR, { recursive: true });
        for (let index = 0; index < 4; index += 1) {
          if (index > 0) await new Promise((resolve) => setTimeout(resolve, 5000));
          const image = await mainWindow.webContents.capturePage();
          await writeFile(path.join(process.env.PET_CAPTURE_SERIES_DIR, `idle-${index}.png`), image.toPNG());
          const bounds = mainWindow.getBounds();
          const display = screen.getDisplayMatching(bounds);
          const pageMetrics = await mainWindow.webContents.executeJavaScript(
            "({ dpr: window.devicePixelRatio, width: window.innerWidth, height: window.innerHeight, canvasWidth: document.querySelector('canvas')?.width, canvasHeight: document.querySelector('canvas')?.height })"
          );
          console.log(
            `[pet] sample ${index}: position=${bounds.x},${bounds.y}, bounds=${bounds.width}x${bounds.height}, display=${display.id}, scale=${display.scaleFactor}, dpr=${pageMetrics.dpr}, page=${pageMetrics.width}x${pageMetrics.height}, canvas=${pageMetrics.canvasWidth}x${pageMetrics.canvasHeight}`
          );
        }
        app.quit();
        return;
      }
      if (process.env.PET_CAPTURE_ACTION) {
        const positionBeforeAction = mainWindow.getPosition();
        const bridgeStatus = await mainWindow.webContents.executeJavaScript("typeof window.desktopPet");
        console.log(`[pet] preload bridge is ${bridgeStatus}`);
        sendCommand({ type: "action", action: process.env.PET_CAPTURE_ACTION });
        if (process.env.PET_CAPTURE_SCALE) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          setPetScale(Math.max(0.3, Math.min(1.2, Number(process.env.PET_CAPTURE_SCALE))));
        }
        await new Promise((resolve) => setTimeout(resolve, Number(process.env.PET_CAPTURE_ACTION_DELAY) || 850));
        const positionAfterAction = mainWindow.getPosition();
        console.log(
          `[pet] window delta after action: ${positionAfterAction[0] - positionBeforeAction[0]}, ${positionAfterAction[1] - positionBeforeAction[1]}`
        );
      }
      const image = await mainWindow.webContents.capturePage();
      const { writeFile } = await import("node:fs/promises");
      await writeFile(process.env.PET_CAPTURE_PATH, image.toPNG());
      app.quit();
    }, 4000);
  });
}

app.whenReady().then(() => {
  app.setAppUserModelId(APP_ID);
  ipcMain.on("pet:show-context-menu", showPetMenu);
  ipcMain.on("pet:drag-start", startDragging);
  ipcMain.on("pet:drag-end", stopDragging);
  ipcMain.on("pet:set-walking", (_event, enabled, nextDirection) => {
    walking = Boolean(enabled);
    if (nextDirection === -1 || nextDirection === 1) direction = nextDirection;
  });
  ipcMain.on("pet:set-support-ratio", (_event, nextRatio) => {
    supportRatio = Math.max(0.5, Math.min(1, Number(nextRatio) || 1));
    if (groundedWindow && mainWindow && !mainWindow.isDestroyed()) {
      const { height } = getPetDimensions();
      floatingPosition.y = groundedWindow.Y - getSurfaceSupportOffset(height);
      verticalVelocity = 0;
      applyPetBounds(floatingPosition.x, floatingPosition.y);
    }
  });
  ipcMain.on("pet:set-custom-scale", (_event, nextScale) => {
    const normalized = Math.max(0.3, Math.min(1.2, Number(nextScale) || petScale));
    setPetScale(Math.round(normalized * 100) / 100);
  });
  createWindow();
  startWindowMonitor();
  physicsTimer = setInterval(updatePhysics, 16);

  tray = new Tray(createTrayIcon());
  tray.setToolTip("阿米娅桌宠");
  tray.on("click", () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) mainWindow.hide();
    else mainWindow.show();
  });
  tray.on("right-click", () => tray.popUpContextMenu(buildMenu()));

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });
});

app.on("before-quit", () => {
  clearInterval(physicsTimer);
  clearInterval(dragTimer);
  monitorProcess?.kill();
});

app.on("window-all-closed", () => app.quit());
