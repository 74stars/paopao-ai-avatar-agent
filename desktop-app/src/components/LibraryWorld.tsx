import { useCursor, useTexture } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  Suspense,
  use,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode
} from "react";
import * as THREE from "three";
import type { EntryListResponseV1, MemoryType } from "@paopao/contracts";
import manifestData from "../../design/assets/library-world-v4/manifest.json";
import type { LibraryLoadState } from "./LibraryState";
import { shelfMeta, shelfOrder } from "./LibraryShelf";
import type { LibraryTheme } from "./library-theme";

declare global {
  interface ImportMeta {
    glob(pattern: string, options?: Record<string, unknown>): Record<string, unknown>;
  }
}

type LatestEntry = EntryListResponseV1["items"][number] | null;

export type LibraryWorldProps = {
  counts: ReadonlyMap<MemoryType, number>;
  total: number | null;
  selectedType: MemoryType | null;
  latest: LatestEntry;
  state: LibraryLoadState;
  error: string;
  queryInput: string;
  theme: LibraryTheme;
  dimmed: boolean;
  focusedInteraction: string | null;
  onSelectType(type: MemoryType): void;
  onTypewriter(): void;
  onBrowse(): void;
  onFocusSearch(): void;
  onToggleTheme(): void;
  onOpenSettings(): void;
};

type Bounds = { x: number; y: number; width: number; height: number };
type Pivot = { x: number; y: number };
type Point = readonly [number, number];
type TextureMap = ReadonlyMap<string, THREE.Texture>;

/**
 * Text safe-area bounds may use normalized world units or source-canvas pixels.
 * The normalizer determines the coordinate system from the values.
 */
type TextSafeArea = {
  id?: string;
  bounds: Bounds;
  padding?: number | { top?: number; right?: number; bottom?: number; left?: number };
  maxLines?: number;
  fontRole?: string;
  alignment?: "left" | "center" | "right";
};

type CutoutObjectData = {
  id: string;
  alpha: true;
  trimBounds: Bounds;
  pivot: Pivot;
  bounds: Bounds;
  layer: string;
  z: number;
  parallax: number;
  hitArea: Bounds;
  alphaThreshold: number;
  variants: { day: string; night: string };
  sha256: string;
  // Optional fields used by newer asset-set schemas.
  interactionGroup?: string | string[];
  rigidGroup?: string;
  textSafeAreas?: TextSafeArea[];
};

type CutoutManifest = {
  schemaVersion: number;
  version: string;
  canvas: { width: number; height: number };
  assets: Array<{ file: string; pixelSize: [number, number]; alpha: true; sha256: string }>;
  objects: CutoutObjectData[];
};

/** Normalized, manifest-agnostic world-space object used by the scene. */
type SceneObject = {
  id: string;
  bounds: Bounds;
  pivot: Pivot;
  z: number;
  parallax: number;
  hitArea: Bounds;
  alphaThreshold: number;
  variants: { day: string; night: string };
  layer: string;
  interactionId: string | null;
  rigidGroup: string | null;
  safeAreas: TextSafeArea[];
};

type SceneManifest = {
  kind: "v4" | "v4.1";
  assetsDir: "library-world-v4" | "library-world-v4-1";
  version: string;
  canvas: { width: number; height: number };
  objects: SceneObject[];
  raw: CutoutManifest;
};

type InteractionRole =
  | "memory-shelf"
  | "typewriter"
  | "letterbox"
  | "theme"
  | "search"
  | "settings"
  | "generic";

type InteractionModel = {
  id: string;
  role: InteractionRole;
  anchor: Point;
  factor: number;
  objects: SceneObject[];
  safeAreas: TextSafeArea[];
};

type RigidGroupModel = { id: string; factor: number; objects: SceneObject[] };

type SceneModel = {
  manifest: SceneManifest;
  interactions: InteractionModel[];
  rigidGroups: RigidGroupModel[];
  staticObjects: SceneObject[];
};

const POINTER_CONTEXT = createContext<MutableRefObject<THREE.Vector2> | null>(null);
const ALPHA_MASKS = new WeakMap<THREE.Texture, AlphaMask>();
const NO_RAYCAST: THREE.Object3D["raycast"] = () => undefined;

const V4_MANIFEST = manifestData as unknown as CutoutManifest;

/**
 * Vite bundles the newer asset set when its manifest exists and otherwise uses
 * the compatibility asset set.
 */
const V41_MANIFEST_KEY = "../../design/assets/library-world-v4-1/manifest.json";
const V41_MANIFEST_LOADERS = import.meta.glob("../../design/assets/library-world-v4-1/manifest.json", {
  import: "default"
}) as unknown as Record<string, () => Promise<unknown>>;

function assertV4Manifest(manifest: CutoutManifest) {
  if (
    !manifest ||
    typeof manifest !== "object" ||
    !Array.isArray(manifest.objects) ||
    !Array.isArray(manifest.assets) ||
    !manifest.canvas
  ) {
    throw new Error("Invalid Living Library V4 manifest");
  }
}

assertV4Manifest(V4_MANIFEST);

function cutoutAsset(name: string, dir: "library-world-v4" | "library-world-v4-1"): string {
  return new URL(`./assets/${dir}/${name}`, window.location.href).toString();
}

function objectCenter(bounds: Bounds): Point {
  return [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2];
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return undefined;
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

function useCutoutTextures(manifest: SceneManifest): TextureMap {
  const files = useMemo(() => manifest.raw.assets.map((asset) => asset.file), [manifest]);
  const urls = useMemo(() => files.map((file) => cutoutAsset(file, manifest.assetsDir)), [files, manifest.assetsDir]);
  const loaded = useTexture(urls) as THREE.Texture[];
  return useMemo(() => {
    const textures = new Map<string, THREE.Texture>();
    loaded.forEach((texture, index) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.anisotropy = 8;
      texture.generateMipmaps = true;
      texture.needsUpdate = true;
      textures.set(files[index], texture);
    });
    return textures;
  }, [files, loaded]);
}

function useRuntimeTextTexture(
  signature: string,
  draw: (context: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => void,
  size: readonly [number, number]
): THREE.CanvasTexture {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = size[0];
    canvas.height = size[1];
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context unavailable");
    context.clearRect(0, 0, canvas.width, canvas.height);
    draw(context, canvas);
    const next = new THREE.CanvasTexture(canvas);
    next.colorSpace = THREE.SRGBColorSpace;
    next.anisotropy = 8;
    next.needsUpdate = true;
    return next;
    // The signature owns redraws for dynamic object-local text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, size[0], size[1]]);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

function fitText(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, Math.max(1, limit - 1))}...` : normalized;
}

function RuntimeTextPlane({
  signature,
  position,
  size,
  canvasSize = [640, 320],
  draw,
  opacity = 1
}: {
  signature: string;
  position: [number, number, number];
  size: [number, number];
  canvasSize?: readonly [number, number];
  draw(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void;
  opacity?: number;
}) {
  const texture = useRuntimeTextTexture(signature, draw, canvasSize);
  return (
    <mesh position={position} renderOrder={2400} raycast={NO_RAYCAST}>
      <planeGeometry args={size} />
      <meshBasicMaterial map={texture} transparent opacity={opacity} depthWrite={false} depthTest toneMapped={false} />
    </mesh>
  );
}

type AlphaMask = { width: number; height: number; alpha: Uint8ClampedArray };

function alphaMask(texture: THREE.Texture): AlphaMask | null {
  const cached = ALPHA_MASKS.get(texture);
  if (cached) return cached;
  const image = texture.image as CanvasImageSource & { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number };
  const sourceWidth = image.naturalWidth ?? image.width ?? 0;
  const sourceHeight = image.naturalHeight ?? image.height ?? 0;
  if (!sourceWidth || !sourceHeight) return null;
  const scale = Math.min(1, 320 / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, width, height);
  const rgba = context.getImageData(0, 0, width, height).data;
  const alpha = new Uint8ClampedArray(width * height);
  for (let source = 3, target = 0; source < rgba.length; source += 4, target += 1) alpha[target] = rgba[source];
  const mask = { width, height, alpha };
  ALPHA_MASKS.set(texture, mask);
  return mask;
}

function useAlphaRaycast(texture: THREE.Texture, threshold: number): THREE.Object3D["raycast"] {
  return useMemo(() => {
    const mask = alphaMask(texture);
    return function alphaAwareRaycast(this: THREE.Mesh, raycaster, intersections) {
      const candidates: THREE.Intersection[] = [];
      THREE.Mesh.prototype.raycast.call(this, raycaster, candidates);
      for (const candidate of candidates) {
        if (!candidate.uv || !mask) {
          intersections.push(candidate);
          continue;
        }
        const x = Math.min(mask.width - 1, Math.max(0, Math.floor(candidate.uv.x * mask.width)));
        const y = Math.min(mask.height - 1, Math.max(0, Math.floor((1 - candidate.uv.y) * mask.height)));
        if (mask.alpha[y * mask.width + x] / 255 >= threshold) intersections.push(candidate);
      }
    };
  }, [texture, threshold]);
}

function styleForObject(id: string, theme: LibraryTheme, dimmed: boolean): { color: string; opacity: number } {
  let color = "#ffffff";
  let opacity = 1;
  if (theme === "night") {
    if (id === "window-sky") color = "#73869a";
    else if (id === "window-far-city") color = "#879bad";
    else if (id === "window-frame" || id.startsWith("shelf-") || id.startsWith("desk-")) color = "#cfbea9";
    else color = "#ead9c6";
  }
  if (id === "window-near-city-lights") opacity = theme === "night" ? 1 : 0.28;
  if (id === "lamp-glow" || id === "lamp-flame") opacity = theme === "night" ? 1 : 0.42;
  if (dimmed) opacity *= 0.48;
  return { color, opacity };
}

function CutoutPlane({
  object,
  texture,
  anchor = [0, 0],
  theme,
  dimmed,
  interactive = false,
  emphasis = false,
  pulse = false
}: {
  object: SceneObject;
  texture: THREE.Texture;
  anchor?: Point;
  theme: LibraryTheme;
  dimmed: boolean;
  interactive?: boolean;
  emphasis?: boolean;
  pulse?: boolean;
}) {
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const center = objectCenter(object.bounds);
  const style = styleForObject(object.id, theme, dimmed);
  const raycast = useAlphaRaycast(texture, object.alphaThreshold);
  const hitCenter = objectCenter(object.hitArea);
  const hasCustomHitArea =
    object.hitArea.x !== object.bounds.x ||
    object.hitArea.y !== object.bounds.y ||
    object.hitArea.width !== object.bounds.width ||
    object.hitArea.height !== object.bounds.height;
  useFrame(({ clock }) => {
    if (!material.current || !pulse) return;
    const wave = 0.93 + Math.sin(clock.elapsedTime * 1.45 + object.z * 17) * 0.07;
    material.current.opacity = style.opacity * wave;
  });
  return (
    <>
      <mesh
        name={object.id}
        position={[center[0] - anchor[0], center[1] - anchor[1], object.z]}
        renderOrder={Math.round((object.z + 1) * 1000)}
        raycast={interactive ? raycast : NO_RAYCAST}
        userData={{ cutoutId: object.id, layer: object.layer, parallax: object.parallax }}
      >
        <planeGeometry args={[object.bounds.width, object.bounds.height]} />
        <meshBasicMaterial
          ref={material}
          map={texture}
          color={emphasis ? "#fff1c7" : style.color}
          transparent
          opacity={style.opacity}
          alphaTest={object.alphaThreshold}
          depthWrite={false}
          depthTest
          toneMapped={false}
        />
      </mesh>
      {interactive && hasCustomHitArea ? (
        <mesh
          name={`${object.id}-hit`}
          position={[hitCenter[0] - anchor[0], hitCenter[1] - anchor[1], object.z + 0.002]}
          visible={false}
        >
          <planeGeometry args={[object.hitArea.width, object.hitArea.height]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      ) : null}
    </>
  );
}

function PointerTracker() {
  const pointer = useContext(POINTER_CONTEXT);
  const { gl } = useThree();
  useEffect(() => {
    if (!pointer) return undefined;
    const canvas = gl.domElement;
    const move = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.current.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -(((event.clientY - rect.top) / rect.height) * 2 - 1)
      );
    };
    const reset = () => pointer.current.set(0, 0);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerleave", reset);
    return () => {
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerleave", reset);
    };
  }, [gl, pointer]);
  return null;
}

function AdaptiveOrthographicCamera() {
  const { camera, size } = useThree();
  useLayoutEffect(() => {
    if (!(camera instanceof THREE.OrthographicCamera)) return;
    camera.position.set(0, 0, 10);
    camera.zoom = Math.max(size.height / 10, size.width / 16);
    camera.near = 0.1;
    camera.far = 30;
    camera.updateProjectionMatrix();
  }, [camera, size.height, size.width]);
  return null;
}

function LayerMotion({ factor, children }: { factor: number; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const pointer = useContext(POINTER_CONTEXT);
  const reduced = useReducedMotion();
  useFrame((_, delta) => {
    if (!ref.current) return;
    const amount = reduced ? 0 : factor;
    const x = (pointer?.current.x ?? 0) * amount;
    const y = (pointer?.current.y ?? 0) * amount * 0.55;
    const blend = Math.min(1, delta * 8);
    ref.current.position.x = THREE.MathUtils.lerp(ref.current.position.x, x, blend);
    ref.current.position.y = THREE.MathUtils.lerp(ref.current.position.y, y, blend);
  });
  return <group ref={ref}>{children}</group>;
}

function StaticCutout({ object, textures, theme, dimmed, pulse = false }: {
  object: SceneObject;
  textures: TextureMap;
  theme: LibraryTheme;
  dimmed: boolean;
  pulse?: boolean;
}) {
  const texture = textures.get(object.variants[theme]);
  if (!texture) return null;
  return (
    <LayerMotion factor={object.parallax}>
      <CutoutPlane object={object} texture={texture} theme={theme} dimmed={dimmed} pulse={pulse} />
    </LayerMotion>
  );
}

function InteractiveCluster({
  interactionId,
  role,
  anchor,
  factor,
  focused,
  selected = false,
  active = false,
  idleAmplitude = 0,
  onActivate,
  children
}: {
  interactionId: string;
  role: string;
  anchor: Point;
  factor: number;
  focused: boolean;
  selected?: boolean;
  active?: boolean;
  idleAmplitude?: number;
  onActivate(): void;
  children: ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);
  const pointer = useContext(POINTER_CONTEXT);
  const reduced = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  useCursor(hovered);
  useFrame(({ clock }, delta) => {
    if (!ref.current) return;
    const motionFactor = reduced ? 0 : factor;
    const idle = reduced ? 0 : Math.sin(clock.elapsedTime * 1.18 + anchor[0]) * idleAmplitude;
    const lift = pressed ? 0.015 : hovered || focused || selected ? 0.055 : 0;
    const targetX = anchor[0] + (pointer?.current.x ?? 0) * motionFactor;
    const targetY = anchor[1] + (pointer?.current.y ?? 0) * motionFactor * 0.55 + idle + lift;
    const targetScale = pressed ? 0.99 : hovered || focused ? 1.025 : 1;
    const targetRotation = active ? 0.16 : hovered ? 0.025 : 0;
    const blend = Math.min(1, delta * 10);
    ref.current.position.x = THREE.MathUtils.lerp(ref.current.position.x, targetX, blend);
    ref.current.position.y = THREE.MathUtils.lerp(ref.current.position.y, targetY, blend);
    ref.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, 1), blend);
    ref.current.rotation.z = THREE.MathUtils.lerp(ref.current.rotation.z, targetRotation, blend);
    ref.current.userData.animationOffset = Number((targetY - anchor[1]).toFixed(4));
  });
  const stop = (event: ThreeEvent<MouseEvent> | ThreeEvent<PointerEvent>) => event.stopPropagation();
  return (
    <group
      ref={ref}
      position={[anchor[0], anchor[1], 0]}
      name={interactionId}
      userData={{ interactionId, id: interactionId, sceneRole: role, focused, selected, active }}
      onPointerOver={(event) => { stop(event); setHovered(true); }}
      onPointerOut={(event) => { stop(event); setHovered(false); setPressed(false); }}
      onPointerDown={(event) => { stop(event); setPressed(true); }}
      onPointerUp={(event) => { stop(event); setPressed(false); }}
      onClick={(event) => { stop(event); setPressed(false); onActivate(); }}
    >
      {children}
    </group>
  );
}

const SHELF_TYPES = new Set<string>(shelfOrder);

const INTERACTION_ALIASES: Record<string, string> = {
  typewriter: "typewriter",
  "typewriter-body": "typewriter",
  "typewriter-keys": "typewriter",
  "typewriter-paper": "typewriter",
  letterbox: "letterbox",
  correspondence: "letterbox",
  "letterbox-body": "letterbox",
  "envelope-stack": "letterbox",
  "wax-seal": "letterbox",
  "theme-lamp": "theme-lamp",
  lamp: "theme-lamp",
  "lamp-body": "theme-lamp",
  "lamp-glow": "theme-lamp",
  search: "search",
  "search-note": "search",
  "search-magnifier": "search",
  "magnifier-body": "search",
  "magnifier-note": "search",
  settings: "settings-gear",
  "settings-fitting": "settings-gear",
  gear: "settings-gear"
};

const LEGACY_INTERACTION_ANCHORS: Record<string, Point> = {
  typewriter: [0.6, -0.75],
  letterbox: [5.25, -0.4],
  "theme-lamp": [-4.2, -1.3],
  search: [5.75, -2.8]
};

const LEGACY_INTERACTION_FACTORS: Record<string, number> = {
  typewriter: 0.08,
  letterbox: 0.08,
  "theme-lamp": 0.08,
  search: 0.09
};

const INTERACTION_ROLE_ORDER: InteractionRole[] = [
  "memory-shelf",
  "typewriter",
  "letterbox",
  "theme",
  "search",
  "settings"
];

function memoryTypeFromId(value: string): string | null {
  const match = value.match(/^(?:memory-books|shelf)-(.*)$/);
  return match && SHELF_TYPES.has(match[1]) ? match[1] : null;
}

function normalizeInteractionId(raw: string | string[] | null | undefined, objectId: string): string | null {
  const candidates = Array.isArray(raw) ? raw : [raw];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const alias = INTERACTION_ALIASES[candidate];
    if (alias) return alias;
    const memoryType = memoryTypeFromId(candidate);
    if (memoryType) return `shelf-${memoryType}`;
  }
  const objectAlias = INTERACTION_ALIASES[objectId];
  if (objectAlias) return objectAlias;
  const memoryType = memoryTypeFromId(objectId);
  return memoryType ? `shelf-${memoryType}` : null;
}

function interactionRole(id: string): InteractionRole {
  if (id.startsWith("shelf-")) return "memory-shelf";
  switch (id) {
    case "typewriter": return "typewriter";
    case "letterbox": return "letterbox";
    case "theme-lamp": return "theme";
    case "search": return "search";
    case "settings-gear": return "settings";
    default: return "generic";
  }
}

function looksLikeCanvasSpace(bounds: Bounds): boolean {
  return Math.abs(bounds.x) > 20 || Math.abs(bounds.y) > 20 || Math.abs(bounds.width) > 20 || Math.abs(bounds.height) > 20;
}

function canvasToWorld(bounds: Bounds, canvas: { width: number; height: number }): Bounds {
  return {
    x: (bounds.x / canvas.width) * 16 - 8,
    y: 5 - ((bounds.y + bounds.height) / canvas.height) * 10,
    width: (bounds.width / canvas.width) * 16,
    height: (bounds.height / canvas.height) * 10
  };
}

function normalizeBounds(bounds: Bounds, canvas: { width: number; height: number }): Bounds {
  return looksLikeCanvasSpace(bounds) ? canvasToWorld(bounds, canvas) : bounds;
}

function normalizeSafeArea(area: TextSafeArea, canvas: { width: number; height: number }): TextSafeArea {
  const isCanvas = looksLikeCanvasSpace(area.bounds);
  const bounds = isCanvas ? canvasToWorld(area.bounds, canvas) : area.bounds;
  const raw = area.padding;
  let top = 0;
  let right = 0;
  let bottom = 0;
  let left = 0;
  if (typeof raw === "number") {
    top = right = bottom = left = raw;
  } else if (raw && typeof raw === "object") {
    top = raw.top ?? 0;
    right = raw.right ?? 0;
    bottom = raw.bottom ?? 0;
    left = raw.left ?? 0;
  }
  if (top !== 0 || right !== 0 || bottom !== 0 || left !== 0) {
    if (isCanvas) {
      const sx = 16 / canvas.width;
      const sy = 10 / canvas.height;
      top *= sy;
      right *= sx;
      bottom *= sy;
      left *= sx;
    }
    return {
      ...area,
      bounds: {
        x: bounds.x + left,
        y: bounds.y + bottom,
        width: Math.max(0, bounds.width - left - right),
        height: Math.max(0, bounds.height - top - bottom)
      }
    };
  }
  return { ...area, bounds };
}

function normalizeV41Manifest(raw: unknown): SceneManifest {
  const manifest = raw as CutoutManifest;
  if (
    !manifest ||
    typeof manifest !== "object" ||
    !Array.isArray(manifest.objects) ||
    !Array.isArray(manifest.assets) ||
    !manifest.canvas ||
    typeof manifest.canvas.width !== "number" ||
    typeof manifest.canvas.height !== "number"
  ) {
    throw new Error("Invalid Living Library V4.1 manifest");
  }
  const canvas = manifest.canvas;
  const objects: SceneObject[] = manifest.objects.map((object) => {
    const interactionId = normalizeInteractionId(object.interactionGroup ?? null, object.id);
    const rigidGroup = typeof object.rigidGroup === "string" && object.rigidGroup.length > 0 ? object.rigidGroup : null;
    return {
      id: object.id,
      bounds: normalizeBounds(object.bounds ?? { x: 0, y: 0, width: 0, height: 0 }, canvas),
      pivot: object.pivot ?? { x: 0.5, y: 0.5 },
      z: object.z ?? 0,
      parallax: object.parallax ?? 0,
      hitArea: normalizeBounds(object.hitArea ?? object.bounds ?? { x: 0, y: 0, width: 0, height: 0 }, canvas),
      alphaThreshold: object.alphaThreshold ?? 0.18,
      variants: object.variants ?? { day: `${object.id}.png`, night: `${object.id}.png` },
      layer: object.layer ?? "",
      interactionId,
      rigidGroup,
      safeAreas: Array.isArray(object.textSafeAreas)
        ? object.textSafeAreas.map((area) => normalizeSafeArea({ ...area }, canvas))
        : []
    };
  });
  const hasV41Fields = objects.some((object) => object.interactionId !== null || object.rigidGroup !== null || object.safeAreas.length > 0);
  return {
    kind: hasV41Fields ? "v4.1" : "v4",
    assetsDir: "library-world-v4-1",
    version: manifest.version,
    canvas,
    objects,
    raw: manifest
  };
}

function normalizeV4Manifest(manifest: CutoutManifest): SceneManifest {
  return {
    kind: "v4",
    assetsDir: "library-world-v4",
    version: manifest.version,
    canvas: manifest.canvas,
    objects: manifest.objects.map((object) => ({
      id: object.id,
      bounds: object.bounds,
      pivot: object.pivot,
      z: object.z,
      parallax: object.parallax,
      hitArea: object.hitArea,
      alphaThreshold: object.alphaThreshold,
      variants: object.variants,
      layer: object.layer,
      interactionId: normalizeInteractionId(null, object.id),
      rigidGroup: null,
      safeAreas: []
    })),
    raw: manifest
  };
}

async function loadSceneManifest(): Promise<SceneManifest> {
  const loader = V41_MANIFEST_LOADERS[V41_MANIFEST_KEY];
  if (loader) {
    try {
      return normalizeV41Manifest(await loader());
    } catch {
      // The newer asset set is unavailable or invalid; use the compatibility set.
    }
  }
  return normalizeV4Manifest(V4_MANIFEST);
}

let sceneManifestPromise: Promise<SceneManifest> | null = null;

function getSceneManifestPromise(): Promise<SceneManifest> {
  sceneManifestPromise ??= loadSceneManifest();
  return sceneManifestPromise;
}

function useSceneManifest(): SceneManifest {
  return use(getSceneManifestPromise());
}

function primaryObject(objects: SceneObject[]): SceneObject {
  let primary = objects[0];
  for (const object of objects) {
    if (object.bounds.width * object.bounds.height > (primary.bounds.width * primary.bounds.height)) {
      primary = object;
    }
  }
  return primary;
}

function pivotPoint(object: SceneObject): Point {
  // Pivot fractions follow canvas semantics (y down): y=1.0 is the visual bottom,
  // i.e. the actual resting/contact point of the group.
  return [
    object.bounds.x + object.pivot.x * object.bounds.width,
    object.bounds.y + (1 - object.pivot.y) * object.bounds.height
  ];
}

function legacyInteractionAnchor(id: string, primary: SceneObject): Point {
  return LEGACY_INTERACTION_ANCHORS[id] ?? objectCenter(primary.bounds);
}

function interactionFactor(id: string, primary: SceneObject, kind: SceneManifest["kind"]): number {
  if (kind === "v4.1") return primary.parallax;
  return LEGACY_INTERACTION_FACTORS[id] ?? primary.parallax;
}

function collectSafeAreas(objects: SceneObject[]): TextSafeArea[] {
  const areas: TextSafeArea[] = [];
  for (const object of objects) areas.push(...object.safeAreas);
  return areas;
}

function buildSceneModel(manifest: SceneManifest): SceneModel {
  const byInteraction = new Map<string, SceneObject[]>();
  const byRigid = new Map<string, SceneObject[]>();
  for (const object of manifest.objects) {
    if (object.interactionId) {
      const list = byInteraction.get(object.interactionId);
      if (list) list.push(object);
      else byInteraction.set(object.interactionId, [object]);
    } else if (object.rigidGroup) {
      const list = byRigid.get(object.rigidGroup);
      if (list) list.push(object);
      else byRigid.set(object.rigidGroup, [object]);
    }
  }
  const interactions: InteractionModel[] = [];
  for (const [id, objects] of byInteraction) {
    const primary = primaryObject(objects);
    interactions.push({
      id,
      role: interactionRole(id),
      anchor: manifest.kind === "v4.1" ? pivotPoint(primary) : legacyInteractionAnchor(id, primary),
      factor: interactionFactor(id, primary, manifest.kind),
      objects,
      safeAreas: collectSafeAreas(objects)
    });
  }
  interactions.sort((a, b) => {
    const rankA = INTERACTION_ROLE_ORDER.indexOf(a.role);
    const rankB = INTERACTION_ROLE_ORDER.indexOf(b.role);
    const orderA = rankA === -1 ? INTERACTION_ROLE_ORDER.length : rankA;
    const orderB = rankB === -1 ? INTERACTION_ROLE_ORDER.length : rankB;
    if (orderA !== orderB) return orderA - orderB;
    if (a.role === "memory-shelf" && b.role === "memory-shelf") {
      return shelfOrder.indexOf(a.id.slice("shelf-".length) as MemoryType) - shelfOrder.indexOf(b.id.slice("shelf-".length) as MemoryType);
    }
    return a.id.localeCompare(b.id);
  });
  const rigidGroups: RigidGroupModel[] = [];
  for (const [id, objects] of byRigid) {
    rigidGroups.push({ id, factor: primaryObject(objects).parallax, objects });
  }
  rigidGroups.sort((a, b) => a.id.localeCompare(b.id));
  const staticObjects = manifest.objects
    .filter((object) => !object.interactionId && !object.rigidGroup)
    .sort((a, b) => a.z - b.z);
  return { manifest, interactions, rigidGroups, staticObjects };
}

function maxObjectZ(objects: SceneObject[]): number {
  let max = -Infinity;
  for (const object of objects) max = Math.max(max, object.z);
  return max === -Infinity ? 0 : max;
}

/**
 * Picks safe areas for named text slots (title/preview/meta/source/query/spine).
 * Matches manifest `id`/`fontRole` hints first, then fills remaining slots in order.
 */
function pickSafeAreas(areas: TextSafeArea[], roles: string[]): Array<TextSafeArea | null> {
  const result: Array<TextSafeArea | null> = roles.map(() => null);
  const used = new Set<number>();
  for (let roleIndex = 0; roleIndex < roles.length; roleIndex += 1) {
    const role = roles[roleIndex];
    for (let i = 0; i < areas.length; i += 1) {
      if (used.has(i)) continue;
      const hint = `${areas[i].id ?? ""} ${areas[i].fontRole ?? ""}`;
      if (hint.includes(role)) {
        result[roleIndex] = areas[i];
        used.add(i);
        break;
      }
    }
  }
  for (let i = 0; i < areas.length && used.size < areas.length; i += 1) {
    if (used.has(i)) continue;
    const slot = result.findIndex((value) => value === null);
    if (slot !== -1) {
      result[slot] = areas[i];
      used.add(i);
    }
  }
  return result;
}

function SafeAreaTextPlane({
  area,
  anchor,
  z,
  signature,
  opacity,
  draw,
  pixelsPerUnit = 400,
  minCanvas = 64
}: {
  area: TextSafeArea;
  anchor: Point;
  z: number;
  signature: string;
  opacity: number;
  draw(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void;
  pixelsPerUnit?: number;
  minCanvas?: number;
}) {
  const width = Math.max(minCanvas, Math.round(area.bounds.width * pixelsPerUnit));
  const height = Math.max(minCanvas, Math.round(area.bounds.height * pixelsPerUnit));
  return (
    <RuntimeTextPlane
      signature={signature}
      position={[area.bounds.x + area.bounds.width / 2 - anchor[0], area.bounds.y + area.bounds.height / 2 - anchor[1], z]}
      size={[area.bounds.width, area.bounds.height]}
      canvasSize={[width, height]}
      opacity={opacity}
      draw={draw}
    />
  );
}

function BookSpineText({
  type,
  count,
  area,
  anchor,
  z,
  opacity
}: {
  type: MemoryType;
  count: number;
  area: TextSafeArea | null;
  anchor: Point;
  z: number;
  opacity: number;
}) {
  const label = shelfMeta[type].label.slice(0, 2);
  const position: [number, number, number] = area
    ? [area.bounds.x + area.bounds.width / 2 - anchor[0], area.bounds.y + area.bounds.height / 2 - anchor[1], z]
    : [0, -0.08, z];
  const size: [number, number] = area ? [area.bounds.width, area.bounds.height] : [0.5, 1.02];
  const canvasSize: readonly [number, number] = area
    ? [Math.max(64, Math.round(area.bounds.width * 360)), Math.max(64, Math.round(area.bounds.height * 360))]
    : [180, 360];
  return (
    <RuntimeTextPlane
      signature={`book-${type}-${count}`}
      position={position}
      size={size}
      canvasSize={canvasSize}
      opacity={opacity}
      draw={(context, canvas) => {
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillStyle = "#efe1bc";
        context.font = `600 ${Math.round(canvas.height * 0.17)}px "Songti SC", "PingFang SC", serif`;
        [...label].forEach((character, index) => context.fillText(character, canvas.width / 2, canvas.height * (0.25 + index * 0.18)));
        context.fillStyle = "#d9c69e";
        context.font = `500 ${Math.round(canvas.height * 0.14)}px "PingFang SC", sans-serif`;
        context.fillText(String(count), canvas.width / 2, canvas.height * 0.78);
      }}
    />
  );
}

function MemoryBookInteraction({ props, interaction, textures }: {
  props: LibraryWorldProps;
  interaction: InteractionModel;
  textures: TextureMap;
}) {
  const type = interaction.id.slice("shelf-".length) as MemoryType;
  if (!SHELF_TYPES.has(type)) return null;
  const object = interaction.objects[0];
  if (!object) return null;
  const texture = textures.get(object.variants[props.theme]);
  if (!texture) return null;
  const focused = props.focusedInteraction === interaction.id;
  const selected = props.selectedType === type;
  const area = pickSafeAreas(interaction.safeAreas, ["spine", "label"])[0] ?? null;
  return (
    <InteractiveCluster
      interactionId={interaction.id}
      role="memory-shelf"
      anchor={interaction.anchor}
      factor={interaction.factor}
      focused={focused}
      selected={selected}
      onActivate={() => props.onSelectType(type)}
    >
      <CutoutPlane object={object} texture={texture} anchor={interaction.anchor} theme={props.theme} dimmed={props.dimmed} interactive emphasis={focused || selected} />
      <BookSpineText type={type} count={props.counts.get(type) ?? 0} area={area} anchor={interaction.anchor} z={object.z + 0.04} opacity={props.dimmed ? 0.45 : 1} />
    </InteractiveCluster>
  );
}

function TypewriterInteraction({ props, interaction, textures }: {
  props: LibraryWorldProps;
  interaction: InteractionModel;
  textures: TextureMap;
}) {
  const anchor = interaction.anchor;
  const focused = props.focusedInteraction === "typewriter";
  const title = props.state === "loading" ? "正在整理书页" : props.state === "error" ? "书房暂时没有回应" : props.latest?.title || "写下第一句话";
  const preview = props.state === "error" ? props.error : props.latest?.currentTextPreview || "让此刻成为一页";
  const meta = props.total === null ? "" : `${props.total} 页记忆`;
  const textZ = maxObjectZ(interaction.objects) + 0.04;
  const [titleArea, previewArea, metaArea] = pickSafeAreas(interaction.safeAreas, ["title", "preview", "meta"]);
  return (
    <InteractiveCluster
      interactionId="typewriter"
      role="typewriter"
      anchor={anchor}
      factor={interaction.factor}
      focused={focused}
      idleAmplitude={props.state === "loading" ? 0.018 : 0}
      onActivate={props.onTypewriter}
    >
      {interaction.objects.map((object) => {
        const texture = textures.get(object.variants[props.theme]);
        return texture ? <CutoutPlane key={object.id} object={object} texture={texture} anchor={anchor} theme={props.theme} dimmed={props.dimmed} interactive emphasis={focused} /> : null;
      })}
      {titleArea && previewArea && metaArea ? (
        <>
          <SafeAreaTextPlane
            area={titleArea}
            anchor={anchor}
            z={textZ}
            signature={`typewriter-title-${title}-${props.state}`}
            opacity={props.dimmed ? 0.45 : 1}
            pixelsPerUnit={500}
            draw={(context, canvas) => {
              context.textAlign = "center";
              context.textBaseline = "middle";
              context.fillStyle = props.state === "error" ? "#8c3e38" : "#3b3831";
              context.font = `600 ${Math.round(canvas.height * 0.78)}px "Songti SC", "PingFang SC", serif`;
              context.fillText(fitText(title, 12), canvas.width / 2, canvas.height / 2, canvas.width * 0.85);
            }}
          />
          <SafeAreaTextPlane
            area={previewArea}
            anchor={anchor}
            z={textZ}
            signature={`typewriter-preview-${preview}-${props.state}`}
            opacity={props.dimmed ? 0.45 : 1}
            pixelsPerUnit={500}
            draw={(context, canvas) => {
              context.textAlign = "center";
              context.textBaseline = "middle";
              context.fillStyle = "#5d574b";
              context.font = `400 ${Math.round(canvas.height * 0.62)}px "Songti SC", "PingFang SC", serif`;
              context.fillText(fitText(preview, 20), canvas.width / 2, canvas.height / 2, canvas.width * 0.85);
            }}
          />
          <SafeAreaTextPlane
            area={metaArea}
            anchor={anchor}
            z={textZ}
            signature={`typewriter-meta-${meta}-${props.state}`}
            opacity={props.dimmed ? 0.45 : 1}
            pixelsPerUnit={500}
            draw={(context, canvas) => {
              context.textAlign = "center";
              context.textBaseline = "middle";
              context.fillStyle = "#81735e";
              context.font = `500 ${Math.round(canvas.height * 0.72)}px "PingFang SC", sans-serif`;
              context.fillText(meta, canvas.width / 2, canvas.height / 2, canvas.width * 0.85);
            }}
          />
        </>
      ) : (
        <RuntimeTextPlane
          signature={`typewriter-${title}-${preview}-${meta}-${props.state}`}
          position={[0.05, 1.42, 0.34]}
          size={[1.24, 1.08]}
          opacity={props.dimmed ? 0.45 : 1}
          draw={(context, canvas) => {
            context.textAlign = "center";
            context.textBaseline = "middle";
            context.fillStyle = props.state === "error" ? "#8c3e38" : "#3b3831";
            context.font = '600 48px "Songti SC", "PingFang SC", serif';
            context.fillText(fitText(title, 12), canvas.width / 2, 76, canvas.width - 70);
            context.fillStyle = "#5d574b";
            context.font = '400 34px "Songti SC", "PingFang SC", serif';
            context.fillText(fitText(preview, 20), canvas.width / 2, 166, canvas.width - 74);
            context.fillStyle = "#81735e";
            context.font = '500 27px "PingFang SC", sans-serif';
            context.fillText(meta, canvas.width / 2, 254, canvas.width - 80);
          }}
        />
      )}
    </InteractiveCluster>
  );
}

function LetterboxInteraction({ props, interaction, textures }: {
  props: LibraryWorldProps;
  interaction: InteractionModel;
  textures: TextureMap;
}) {
  const anchor = interaction.anchor;
  const focused = props.focusedInteraction === "letterbox";
  const source = props.latest ? (props.latest.source === "desktop" ? "桌面来信" : "飞书来信") : "等候来信";
  const sealZ = interaction.objects.find((object) => object.id === "wax-seal")?.z;
  const envelopeZ = interaction.objects.find((object) => object.id === "envelope-stack")?.z ?? maxObjectZ(interaction.objects);
  const textZ = sealZ === undefined ? envelopeZ + 0.04 : Math.min(envelopeZ + 0.04, sealZ - 0.01);
  const [sourceArea] = pickSafeAreas(interaction.safeAreas, ["source"]);
  return (
    <InteractiveCluster interactionId="letterbox" role="letterbox" anchor={anchor} factor={interaction.factor} focused={focused} onActivate={props.onBrowse}>
      {interaction.objects.map((object) => {
        const texture = textures.get(object.variants[props.theme]);
        return texture ? <CutoutPlane key={object.id} object={object} texture={texture} anchor={anchor} theme={props.theme} dimmed={props.dimmed} interactive emphasis={focused} /> : null;
      })}
      {sourceArea ? (
        <SafeAreaTextPlane
          area={sourceArea}
          anchor={anchor}
          z={textZ}
          signature={`letter-${source}`}
          opacity={props.dimmed ? 0.45 : 0.9}
          pixelsPerUnit={444}
          draw={(context, canvas) => {
            context.textAlign = "center";
            context.textBaseline = "middle";
            context.fillStyle = "#705a3f";
            context.font = `600 ${Math.round(canvas.height * 0.65)}px "Songti SC", "PingFang SC", serif`;
            context.fillText(fitText(source, 20), canvas.width / 2, canvas.height / 2, canvas.width * 0.85);
          }}
        />
      ) : (
        <RuntimeTextPlane
          signature={`letter-${source}`}
          position={[0.06, 0.22, 0.36]}
          size={[1.08, 0.28]}
          opacity={props.dimmed ? 0.45 : 0.9}
          canvasSize={[480, 120]}
          draw={(context, canvas) => {
            context.textAlign = "center";
            context.textBaseline = "middle";
            context.fillStyle = "#705a3f";
            context.font = '600 34px "Songti SC", "PingFang SC", serif';
            context.fillText(source, canvas.width / 2, canvas.height / 2, canvas.width - 40);
          }}
        />
      )}
    </InteractiveCluster>
  );
}

function LampInteraction({ props, interaction, textures }: {
  props: LibraryWorldProps;
  interaction: InteractionModel;
  textures: TextureMap;
}) {
  const anchor = interaction.anchor;
  const focused = props.focusedInteraction === "theme-lamp";
  return (
    <InteractiveCluster interactionId="theme-lamp" role="theme" anchor={anchor} factor={interaction.factor} focused={focused} onActivate={props.onToggleTheme}>
      {interaction.objects.map((object) => {
        const texture = textures.get(object.variants[props.theme]);
        return texture ? <CutoutPlane key={object.id} object={object} texture={texture} anchor={anchor} theme={props.theme} dimmed={props.dimmed} interactive emphasis={focused} pulse={object.id === "lamp-glow" || object.id === "lamp-flame"} /> : null;
      })}
    </InteractiveCluster>
  );
}

function SearchInteraction({ props, interaction, textures }: {
  props: LibraryWorldProps;
  interaction: InteractionModel;
  textures: TextureMap;
}) {
  const anchor = interaction.anchor;
  const focused = props.focusedInteraction === "search";
  const textZ = maxObjectZ(interaction.objects) + 0.04;
  const [queryArea] = pickSafeAreas(interaction.safeAreas, ["query", "search"]);
  return (
    <InteractiveCluster interactionId="search" role="search" anchor={anchor} factor={interaction.factor} focused={focused} onActivate={props.onFocusSearch}>
      {interaction.objects.map((object) => {
        const texture = textures.get(object.variants[props.theme]);
        return texture ? <CutoutPlane key={object.id} object={object} texture={texture} anchor={anchor} theme={props.theme} dimmed={props.dimmed} interactive emphasis={focused} /> : null;
      })}
      {queryArea ? (
        <SafeAreaTextPlane
          area={queryArea}
          anchor={anchor}
          z={textZ}
          signature={`search-${props.queryInput}-${focused}`}
          opacity={props.dimmed ? 0.45 : 1}
          pixelsPerUnit={395}
          draw={(context, canvas) => {
            context.textAlign = "center";
            context.textBaseline = "middle";
            context.fillStyle = "#4f5960";
            context.font = `500 ${Math.round(canvas.height * 0.56)}px "Songti SC", "PingFang SC", serif`;
            context.fillText(fitText(props.queryInput || (focused ? "输入关键词" : "翻找书页"), 18), canvas.width / 2, canvas.height / 2, canvas.width * 0.85);
          }}
        />
      ) : (
        <RuntimeTextPlane
          signature={`search-${props.queryInput}-${focused}`}
          position={[-0.5, 0.02, 0.39]}
          size={[1.72, 0.34]}
          opacity={props.dimmed ? 0.45 : 1}
          canvasSize={[680, 140]}
          draw={(context, canvas) => {
            context.textAlign = "center";
            context.textBaseline = "middle";
            context.fillStyle = "#4f5960";
            context.font = '500 40px "Songti SC", "PingFang SC", serif';
            context.fillText(fitText(props.queryInput || (focused ? "输入关键词" : "翻找书页"), 18), canvas.width / 2, canvas.height / 2, canvas.width - 64);
          }}
        />
      )}
    </InteractiveCluster>
  );
}

function SettingsInteraction({ props, interaction, textures }: {
  props: LibraryWorldProps;
  interaction: InteractionModel;
  textures: TextureMap;
}) {
  const object = interaction.objects[0];
  if (!object) return null;
  const texture = textures.get(object.variants[props.theme]);
  if (!texture) return null;
  const focused = props.focusedInteraction === "settings-gear";
  return (
    <InteractiveCluster interactionId="settings-gear" role="settings" anchor={interaction.anchor} factor={interaction.factor} focused={focused} active={props.dimmed} onActivate={props.onOpenSettings}>
      {interaction.objects.map((member) => {
        const memberTexture = textures.get(member.variants[props.theme]);
        return memberTexture ? <CutoutPlane key={member.id} object={member} texture={memberTexture} anchor={interaction.anchor} theme={props.theme} dimmed={props.dimmed} interactive emphasis={focused} /> : null;
      })}
    </InteractiveCluster>
  );
}

function GenericInteraction({ props, interaction, textures }: {
  props: LibraryWorldProps;
  interaction: InteractionModel;
  textures: TextureMap;
}) {
  const anchor = interaction.anchor;
  const focused = props.focusedInteraction === interaction.id;
  return (
    <InteractiveCluster interactionId={interaction.id} role={interaction.role} anchor={anchor} factor={interaction.factor} focused={focused} onActivate={() => undefined}>
      {interaction.objects.map((object) => {
        const texture = textures.get(object.variants[props.theme]);
        return texture ? <CutoutPlane key={object.id} object={object} texture={texture} anchor={anchor} theme={props.theme} dimmed={props.dimmed} interactive emphasis={focused} /> : null;
      })}
    </InteractiveCluster>
  );
}

function InteractionRenderer({ interaction, props, textures }: {
  interaction: InteractionModel;
  props: LibraryWorldProps;
  textures: TextureMap;
}) {
  switch (interaction.role) {
    case "memory-shelf":
      return <MemoryBookInteraction interaction={interaction} props={props} textures={textures} />;
    case "typewriter":
      return <TypewriterInteraction interaction={interaction} props={props} textures={textures} />;
    case "letterbox":
      return <LetterboxInteraction interaction={interaction} props={props} textures={textures} />;
    case "theme":
      return <LampInteraction interaction={interaction} props={props} textures={textures} />;
    case "search":
      return <SearchInteraction interaction={interaction} props={props} textures={textures} />;
    case "settings":
      return <SettingsInteraction interaction={interaction} props={props} textures={textures} />;
    default:
      return <GenericInteraction interaction={interaction} props={props} textures={textures} />;
  }
}

function StructureRenderer({ model, props, textures }: {
  model: SceneModel;
  props: LibraryWorldProps;
  textures: TextureMap;
}) {
  return (
    <>
      {model.rigidGroups.map((group) => (
        <LayerMotion key={group.id} factor={group.factor}>
          {group.objects.map((object) => {
            const texture = textures.get(object.variants[props.theme]);
            return texture ? <CutoutPlane key={object.id} object={object} texture={texture} theme={props.theme} dimmed={props.dimmed} pulse={object.id === "window-near-city-lights"} /> : null;
          })}
        </LayerMotion>
      ))}
      {model.staticObjects.map((object) => (
        <StaticCutout key={object.id} object={object} textures={textures} theme={props.theme} dimmed={props.dimmed} pulse={object.id === "window-near-city-lights"} />
      ))}
    </>
  );
}

function SceneTestBridge({ manifest }: { manifest: SceneManifest }) {
  const { gl, scene, camera, size } = useThree();
  const frame = useRef(0);
  useFrame(() => { frame.current += 1; });
  useEffect(() => {
    const target = window as unknown as { __paopaoSceneTest?: unknown };
    const interactionId = (object: THREE.Object3D | null): string | null => {
      let current = object;
      while (current) {
        if (typeof current.userData.interactionId === "string") return current.userData.interactionId;
        current = current.parent;
      }
      return null;
    };
    const projectedRect = (object: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(object);
      const points = [
        new THREE.Vector3(box.min.x, box.min.y, box.min.z), new THREE.Vector3(box.min.x, box.min.y, box.max.z),
        new THREE.Vector3(box.min.x, box.max.y, box.min.z), new THREE.Vector3(box.min.x, box.max.y, box.max.z),
        new THREE.Vector3(box.max.x, box.min.y, box.min.z), new THREE.Vector3(box.max.x, box.min.y, box.max.z),
        new THREE.Vector3(box.max.x, box.max.y, box.min.z), new THREE.Vector3(box.max.x, box.max.y, box.max.z)
      ].map((point) => point.project(camera));
      const xs = points.map((point) => (point.x + 1) * size.width / 2);
      const ys = points.map((point) => (1 - point.y) * size.height / 2);
      return { x: Math.min(...xs), y: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
    };
    target.__paopaoSceneTest = {
      snapshot: () => {
        scene.updateMatrixWorld(true);
        const objects: Array<Record<string, unknown>> = [];
        const cutouts: Array<Record<string, unknown>> = [];
        scene.traverse((object) => {
          if (object.userData.interactionId) {
            objects.push({
              id: object.userData.interactionId,
              role: object.userData.sceneRole,
              rect: projectedRect(object),
              position: object.getWorldPosition(new THREE.Vector3()).toArray(),
              state: { ...object.userData }
            });
          }
          if (object.userData.cutoutId) {
            cutouts.push({
              id: object.userData.cutoutId,
              layer: object.userData.layer,
              rect: projectedRect(object),
              position: object.getWorldPosition(new THREE.Vector3()).toArray()
            });
          }
        });
        return {
          frame: frame.current,
          manifest: {
            kind: manifest.kind,
            version: manifest.version,
            objectCount: manifest.objects.length
          },
          camera: { type: camera.type, zoom: camera instanceof THREE.OrthographicCamera ? camera.zoom : null },
          canvas: { width: gl.domElement.clientWidth, height: gl.domElement.clientHeight, drawingBufferWidth: gl.domElement.width, drawingBufferHeight: gl.domElement.height },
          renderer: { calls: gl.info.render.calls, geometries: gl.info.memory.geometries, textures: gl.info.memory.textures, webgl2: gl.capabilities.isWebGL2 },
          objects,
          cutouts
        };
      },
      raycast: (clientX: number, clientY: number) => {
        const rect = gl.domElement.getBoundingClientRect();
        const pointer = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(scene.children, true);
        return hits.map((hit) => ({ id: interactionId(hit.object), distance: hit.distance, object: hit.object.name || hit.object.type })).filter((hit) => hit.id);
      }
    };
    return () => { delete target.__paopaoSceneTest; };
  }, [camera, gl, manifest, scene, size.height, size.width]);
  return null;
}

function CutoutScene(props: LibraryWorldProps) {
  const manifest = useSceneManifest();
  const textures = useCutoutTextures(manifest);
  const model = useMemo(() => buildSceneModel(manifest), [manifest]);
  return (
    <>
      <color attach="background" args={[props.theme === "day" ? "#b9aa9a" : "#252a2d"]} />
      <AdaptiveOrthographicCamera />
      <PointerTracker />
      <StructureRenderer model={model} props={props} textures={textures} />
      {model.interactions.map((interaction) => (
        <InteractionRenderer key={interaction.id} interaction={interaction} props={props} textures={textures} />
      ))}
      <SceneTestBridge manifest={manifest} />
    </>
  );
}

export function LibraryWorld(props: LibraryWorldProps) {
  const pointer = useRef(new THREE.Vector2());
  return (
    <POINTER_CONTEXT.Provider value={pointer}>
      <Canvas
        orthographic
        className="library-world-canvas"
        data-testid="library-world-canvas"
        dpr={[1, 2]}
        camera={{ position: [0, 0, 10], zoom: 90, near: 0.1, far: 30 }}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.NoToneMapping;
          gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        }}
      >
        <Suspense fallback={null}>
          <CutoutScene {...props} />
        </Suspense>
      </Canvas>
    </POINTER_CONTEXT.Provider>
  );
}
