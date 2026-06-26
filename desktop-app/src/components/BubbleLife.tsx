import { Float, Sparkles } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { PetState } from "../types/domain";

const STATE_COLORS: Record<PetState, [string, string]> = {
  quiet: ["#bce7ff", "#fff5cf"],
  listening: ["#8bd4ff", "#eefeff"],
  remembering: ["#d0c5ff", "#fff4cf"],
  thinking: ["#9cc8ff", "#f0bfae"],
  insight: ["#ffe29c", "#f19d7d"],
  sleeping: ["#9aa9c2", "#c8d2de"]
};

function LivingOrb({ state, compact }: { state: PetState; compact?: boolean }) {
  const mesh = useRef<THREE.Mesh>(null);
  const core = useRef<THREE.Mesh>(null);
  const [outer, inner] = STATE_COLORS[state];
  const speed = state === "thinking" ? 1.8 : state === "listening" ? 1.45 : state === "sleeping" ? 0.35 : 0.75;

  useFrame(({ clock }) => {
    const time = clock.getElapsedTime();
    if (mesh.current) {
      const pulse = 1 + Math.sin(time * speed * 2) * (state === "insight" ? 0.045 : 0.025);
      mesh.current.scale.set(pulse, pulse * (1 + Math.cos(time * 0.8) * 0.018), pulse);
      mesh.current.rotation.y = time * 0.1;
    }
    if (core.current) core.current.scale.setScalar(0.48 + Math.sin(time * speed * 2.4) * 0.045);
  });

  const physical = useMemo(() => ({ transmission: 0.92, roughness: 0.08, thickness: 1.4, ior: 1.35, iridescence: 0.82, iridescenceIOR: 1.3 }), []);

  return (
    <Float speed={1.2} rotationIntensity={0.08} floatIntensity={compact ? 0.16 : 0.28}>
      <mesh ref={mesh}>
        <icosahedronGeometry args={[1, 7]} />
        <meshPhysicalMaterial color={outer} emissive={outer} emissiveIntensity={0.06} transparent opacity={0.92} clearcoat={1} {...physical} />
      </mesh>
      <mesh ref={core}>
        <sphereGeometry args={[0.72, 48, 48]} />
        <meshStandardMaterial color={inner} emissive={inner} emissiveIntensity={state === "insight" ? 2.3 : 1.25} transparent opacity={0.62} />
      </mesh>
      <Sparkles count={compact ? 12 : 24} scale={2.7} size={1.8} speed={0.22} opacity={0.35} color="#ffffff" />
    </Float>
  );
}

export function BubbleLife({ state = "quiet", compact = false, className = "" }: { state?: PetState; compact?: boolean; className?: string }) {
  return (
    <div className={`bubble-canvas ${className}`}>
      <Canvas camera={{ position: [0, 0, compact ? 3.3 : 3.8], fov: 38 }} dpr={[1, 1.75]}>
        <ambientLight intensity={1.45} />
        <directionalLight position={[-3, 4, 5]} intensity={2.2} color="#fff8e8" />
        <pointLight position={[3, -2, 4]} intensity={3} color="#99d8ff" />
        <LivingOrb state={state} compact={compact} />
      </Canvas>
    </div>
  );
}
