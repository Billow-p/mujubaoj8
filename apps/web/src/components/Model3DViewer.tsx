/**
 * 3D 模型预览（three.js）。
 *
 * 两个作用：
 * 1) 让用户确认「解析出来的确实是我那个件」，别填错参数；
 * 2) 出一张缩略图，走一期的件图通道存起来 —— 这样导出的 Excel 报价单上就有件的样子。
 *
 * 用完必须 dispose：WebGL 上下文很占资源，反复打开会拖垮页面。
 */

import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react';
import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  BufferGeometry,
  BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  DirectionalLight,
  AmbientLight,
  Box3,
  Vector3,
  Color,
  DoubleSide,
} from 'three';
import type { MeshData } from '../utils/geometry/types';

export interface Model3DViewerHandle {
  /** 截一张当前视角的图，返回 PNG 的 data URL */
  capture: () => string | null;
}

interface Props {
  mesh: MeshData;
  height?: number;
  /** 背景色，默认浅灰（卡片里更协调） */
  bg?: string;
  /** WebGL 不可用时回调 */
  onError?: (msg: string) => void;
  /** 渲染完成回调（截图前必须等这一下，否则拿到的是空白帧） */
  onReady?: () => void;
}

export const Model3DViewer = forwardRef<Model3DViewerHandle, Props>(function Model3DViewer(
  { mesh, height = 220, bg = '#f8fafc', onError, onReady },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // 用 ref 存回调，避免父组件重渲染导致整个场景重建
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<PerspectiveCamera | null>(null);
  const dragRef = useRef<{ x: number; y: number; rx: number; ry: number } | null>(null);
  const rotRef = useRef({ rx: -0.6, ry: 0.8 });

  // 渲染一次（旋转角度变了就重画）
  const draw = () => {
    const r = rendererRef.current, s = sceneRef.current, c = cameraRef.current;
    if (!r || !s || !c) return;
    const { rx, ry } = rotRef.current;
    const dist = c.userData.dist as number;
    c.position.set(
      dist * Math.cos(rx) * Math.sin(ry),
      dist * Math.sin(rx) + (c.userData.centerY as number),
      dist * Math.cos(rx) * Math.cos(ry),
    );
    c.lookAt(0, c.userData.centerY as number, 0);
    r.render(s, c);
  };

  useImperativeHandle(ref, () => ({
    capture: () => {
      const r = rendererRef.current;
      if (!r) return null;
      try {
        return r.domElement.toDataURL('image/png');
      } catch {
        return null;
      }
    },
  }));

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !mesh?.positions?.length) return;

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({
        antialias: true,
        // 要截图就必须开，否则 toDataURL 拿到空白
        preserveDrawingBuffer: true,
      });
    } catch {
      errorRef.current?.('浏览器不支持 WebGL，无法预览 3D（不影响参数计算）');
      return;
    }

    const w = host.clientWidth || 320;
    renderer.setSize(w, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.cursor = 'grab';
    host.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new Scene();
    scene.background = new Color(bg);
    sceneRef.current = scene;

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(mesh.positions, 3));
    if (mesh.indices && mesh.indices.length) {
      geo.setIndex(new BufferAttribute(mesh.indices, 1));
    }
    geo.computeVertexNormals();
    geo.computeBoundingBox();

    const mat = new MeshStandardMaterial({
      color: '#94a3b8',
      roughness: 0.55,
      metalness: 0.25,
      side: DoubleSide,
    });
    const model = new Mesh(geo, mat);

    // 把模型挪到原点，相机才好转
    const box = new Box3().setFromBufferAttribute(
      geo.getAttribute('position') as BufferAttribute,
    );
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    model.position.set(-center.x, -center.y, -center.z);
    scene.add(model);

    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const camera = new PerspectiveCamera(45, w / height, maxDim / 1000, maxDim * 100);
    // 相机距离按模型尺寸算，保证刚好装满画面
    const dist = maxDim / (2 * Math.tan((45 * Math.PI) / 360)) * 1.8;
    camera.userData.dist = dist;
    camera.userData.centerY = 0;
    cameraRef.current = camera;

    const key = new DirectionalLight(0xffffff, 2.2);
    key.position.set(maxDim, maxDim * 1.4, maxDim);
    scene.add(key);
    const fill = new DirectionalLight(0xffffff, 0.7);
    fill.position.set(-maxDim, -maxDim * 0.6, -maxDim * 0.8);
    scene.add(fill);
    scene.add(new AmbientLight(0xffffff, 1.1));

    draw();
    // 通知外面可以截图了（requestAnimationFrame 保证这一帧已经真正画上去）
    requestAnimationFrame(() => readyRef.current?.());

    // ---- 拖拽旋转 ----
    const el = renderer.domElement;
    const onDown = (e: MouseEvent) => {
      dragRef.current = { x: e.clientX, y: e.clientY, rx: rotRef.current.rx, ry: rotRef.current.ry };
      el.style.cursor = 'grabbing';
    };
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      rotRef.current.ry = d.ry + (e.clientX - d.x) * 0.01;
      rotRef.current.rx = Math.max(-1.4, Math.min(1.4, d.rx - (e.clientY - d.y) * 0.01));
      draw();
    };
    const onUp = () => {
      dragRef.current = null;
      el.style.cursor = 'grab';
    };
    el.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    // ---- 滚轮缩放 ----
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const next = (camera.userData.dist as number) * (e.deltaY > 0 ? 1.12 : 0.89);
      camera.userData.dist = Math.max(maxDim * 0.4, Math.min(maxDim * 20, next));
      draw();
    };
    el.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      el.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      el.removeEventListener('wheel', onWheel);
      geo.dispose();
      mat.dispose();
      renderer.dispose();
      if (el.parentNode) el.parentNode.removeChild(el);
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
    };
  }, [mesh, height, bg]);

  return <div ref={hostRef} style={{ width: '100%', height }} className="rounded overflow-hidden" />;
});
