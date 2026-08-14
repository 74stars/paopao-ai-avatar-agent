import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { MemoryType } from "@paopao/contracts";
import { shelfMeta, shelfOrder } from "./LibraryShelf";
import type { LibraryLoadState } from "./LibraryState";
import type { LibraryTheme } from "./library-theme";

const MASTER_WIDTH = 1800;
const MASTER_HEIGHT = 1126;

type Bounds = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };
type SceneAction = "idle" | "letterbox";
type SceneFrameAction = SceneAction | "books";
export type LibraryMasterAction = SceneAction;

export type LibraryMasterFrame = {
  action: SceneFrameAction;
  selectedType: MemoryType | null;
  src: string;
};

const HIT_AREAS: Record<string, Bounds> = {
  typewriter: { x: 656, y: 410, width: 400, height: 280 },
  letterbox: { x: 1152, y: 490, width: 368, height: 225 },
  "theme-lamp": { x: 260, y: 495, width: 150, height: 190 }
};

const SHELF_HIT_AREAS: Record<MemoryType, Bounds> = {
  diary: { x: 600, y: 25, width: 170, height: 365 },
  thought: { x: 755, y: 10, width: 180, height: 380 },
  person: { x: 900, y: 10, width: 150, height: 380 },
  reading: { x: 1040, y: 10, width: 150, height: 380 },
  goal: { x: 1170, y: 10, width: 150, height: 380 },
  other: { x: 1290, y: 10, width: 120, height: 380 }
};

const SHELF_LABEL_POSITIONS: Record<MemoryType, Point> = {
  diary: { x: 713, y: 375 },
  thought: { x: 840, y: 375 },
  person: { x: 967, y: 375 },
  reading: { x: 1093, y: 375 },
  goal: { x: 1220, y: 375 },
  other: { x: 1347, y: 375 }
};

const BOOK_STATE_BY_TYPE: Record<MemoryType, string> = {
  diary: "diary",
  thought: "memory",
  person: "third-group",
  reading: "third-group",
  goal: "fourth-group",
  other: "fourth-group"
};

const decodedFrames = new Map<string, Promise<void>>();

export type LibraryMasterSceneProps = {
  counts: ReadonlyMap<MemoryType, number>;
  total: number | null;
  selectedType: MemoryType | null;
  state: LibraryLoadState;
  error: string;
  latestTitle: string | null;
  theme: LibraryTheme;
  visualAction: LibraryMasterAction;
  onSelectType(type: MemoryType): void;
  onTypewriter(): void;
  onBrowse(): void;
  onToggleTheme(): void;
  onFramePresented?(frame: LibraryMasterFrame): void;
  onFrameUnavailable?(frame: LibraryMasterFrame): void;
};

function assetPath(theme: LibraryTheme, action: SceneFrameAction, selectedType: MemoryType | null): string {
  if (action === "letterbox") return `./assets/library-master-v1/${theme}-correspondence-letter-lift.png`;
  if (action === "books" && selectedType) {
    return `./assets/library-master-v1/${theme}-books-${BOOK_STATE_BY_TYPE[selectedType]}-pull.png`;
  }
  return `./assets/library-master-v1/${theme}-idle.png`;
}

function frameFor(theme: LibraryTheme, action: SceneFrameAction, selectedType: MemoryType | null): LibraryMasterFrame {
  return { action, selectedType, src: assetPath(theme, action, selectedType) };
}

function decodeFrame(src: string): Promise<void> {
  if (typeof Image === "undefined") return Promise.resolve();
  const cached = decodedFrames.get(src);
  if (cached) return cached;

  const image = new Image();
  const decoded = new Promise<void>((resolve, reject) => {
    image.onload = () => {
      if (typeof image.decode !== "function") {
        resolve();
        return;
      }
      void image.decode().then(resolve, reject);
    };
    image.onerror = () => reject(new Error(`Unable to load scene frame: ${src}`));
    image.src = src;
  }).catch((error) => {
    decodedFrames.delete(src);
    throw error;
  });
  decodedFrames.set(src, decoded);
  return decoded;
}

function preloadThemeFrames(theme: LibraryTheme): void {
  const paths = new Set<string>([
    assetPath(theme, "idle", null),
    assetPath(theme, "letterbox", null),
    ...shelfOrder.map((type) => assetPath(theme, "books", type))
  ]);
  for (const path of paths) void decodeFrame(path).catch(() => undefined);
}

function styleBounds(bounds: Bounds): CSSProperties {
  return {
    left: `${(bounds.x / MASTER_WIDTH) * 100}%`,
    top: `${(bounds.y / MASTER_HEIGHT) * 100}%`,
    width: `${(bounds.width / MASTER_WIDTH) * 100}%`,
    height: `${(bounds.height / MASTER_HEIGHT) * 100}%`
  };
}

function styleLabelPosition(bounds: Bounds, position: Point): CSSProperties {
  return {
    left: `${((position.x - bounds.x) / bounds.width) * 100}%`,
    top: `${((position.y - bounds.y) / bounds.height) * 100}%`
  };
}

function SceneHitButton({
  id,
  bounds,
  label,
  title,
  visibleLabel,
  labelPosition,
  pressed,
  onClick
}: {
  id: string;
  bounds: Bounds;
  label: string;
  title?: string;
  visibleLabel?: string;
  labelPosition?: Point;
  pressed?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      className="library-master-hit"
      style={styleBounds(bounds)}
      aria-label={label}
      aria-pressed={pressed}
      title={title}
      data-scene-hit={id}
      data-testid={`library-master-hit-${id}`}
      onClick={onClick}
    >
      {visibleLabel && labelPosition ? (
        <span className="library-master-entry-label" style={styleLabelPosition(bounds, labelPosition)} data-entry-label={id} aria-hidden="true">{visibleLabel}</span>
      ) : null}
    </button>
  );
}

export function LibraryMasterScene(props: LibraryMasterSceneProps) {
  const action: SceneFrameAction = props.selectedType ? "books" : props.visualAction;
  const requestedFrame = frameFor(props.theme, action, props.selectedType);
  const [displayedSrc, setDisplayedSrc] = useState(requestedFrame.src);
  const presentedRef = useRef(props.onFramePresented);
  const unavailableRef = useRef(props.onFrameUnavailable);
  const lastReportedRef = useRef("");
  const selectedLabel = props.selectedType ? shelfMeta[props.selectedType].label : null;

  useEffect(() => { presentedRef.current = props.onFramePresented; }, [props.onFramePresented]);
  useEffect(() => { unavailableRef.current = props.onFrameUnavailable; }, [props.onFrameUnavailable]);

  useEffect(() => {
    let cancelled = false;
    let animationFrame = 0;
    const frameKey = `${requestedFrame.action}:${requestedFrame.selectedType ?? ""}:${requestedFrame.src}`;

    if (requestedFrame.src === displayedSrc) {
      if (lastReportedRef.current !== frameKey) {
        lastReportedRef.current = frameKey;
        presentedRef.current?.(requestedFrame);
      }
      return;
    }

    void decodeFrame(requestedFrame.src).then(() => {
      if (cancelled) return;
      animationFrame = window.requestAnimationFrame(() => {
        if (cancelled) return;
        setDisplayedSrc(requestedFrame.src);
        lastReportedRef.current = frameKey;
        presentedRef.current?.(requestedFrame);
      });
    }).catch(() => {
      if (!cancelled) unavailableRef.current?.(requestedFrame);
    });

    return () => {
      cancelled = true;
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, [displayedSrc, requestedFrame.action, requestedFrame.selectedType, requestedFrame.src]);

  useEffect(() => {
    const timer = window.setTimeout(() => preloadThemeFrames(props.theme), 0);
    return () => window.clearTimeout(timer);
  }, [props.theme]);

  return (
    <div
      className="library-master-scene"
      data-testid="library-master-scene"
      data-theme={props.theme}
      data-state={action}
      data-selected-type={props.selectedType ?? ""}
      data-displayed-src={displayedSrc}
      aria-label="活书房写实场景"
    >
      <div className="library-master-frame">
        {/* decoding="sync" keeps the previous frame painted until the decoded swap commits,
            so a frame switch never flashes the dark scene background or tears horizontally. */}
        <img
          className="library-master-image"
          src={displayedSrc}
          alt=""
          draggable={false}
          decoding="sync"
          data-testid="library-master-image"
        />
        <div className="library-master-hit-layer" aria-label="活书房物件">
          {shelfOrder.map((type) => (
            <SceneHitButton
              key={type}
              id={`shelf-${type}`}
              bounds={SHELF_HIT_AREAS[type]}
              label={`${shelfMeta[type].label}，${props.counts.get(type) ?? 0} 条记录`}
              visibleLabel={`${shelfMeta[type].label}${props.total === null ? "" : ` ${props.counts.get(type) ?? 0}`}`}
              labelPosition={SHELF_LABEL_POSITIONS[type]}
              pressed={props.selectedType === type}
              onClick={() => props.onSelectType(type)}
            />
          ))}
          <SceneHitButton id="typewriter" bounds={HIT_AREAS.typewriter} label={props.latestTitle ? `打开最近记录：${props.latestTitle}` : "从打字机开始记录"} title={props.latestTitle ? "最近记录" : "新建记录"} onClick={props.onTypewriter} />
          <SceneHitButton id="letterbox" bounds={HIT_AREAS.letterbox} label="浏览最近记录" title="最近记录" onClick={props.onBrowse} />
          <SceneHitButton id="theme-lamp" bounds={HIT_AREAS["theme-lamp"]} label={props.theme === "day" ? "切换到夜间模式" : "切换到日间模式"} title={props.theme === "day" ? "切换至夜间" : "切换至日间"} onClick={props.onToggleTheme} />
        </div>
      </div>
      <span className="visually-hidden" aria-live="polite">
        {props.state === "loading" ? "正在读取活书房" : props.state === "error" ? props.error : selectedLabel ? `已选择${selectedLabel}` : props.total === null ? "" : `共有 ${props.total} 条记录`}
      </span>
    </div>
  );
}
