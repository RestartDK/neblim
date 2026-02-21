import { useEffect, useMemo, type RefObject } from "react";

import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { DoubleSide } from "three";

import type { Pose3dPerson } from "@/services/pose3d-service";

interface Pose3DViewerProps {
  persons: Pose3dPerson[];
  canvasRef?: RefObject<HTMLCanvasElement | null>;
}

interface MappedPosePoint {
  id: string;
  x: number;
  y: number;
  z: number;
  uncertaintyRadius: number;
}

const FLOOR_OFFSET = 0.015;

export function Pose3DViewer({ persons, canvasRef }: Pose3DViewerProps) {
  const mappedPersons = useMemo<MappedPosePoint[]>(
    () =>
      persons.map((person) => ({
        id: person.id,
        x: person.location_3d.x,
        y: Math.abs(person.location_3d.z),
        z: person.location_3d.y,
        uncertaintyRadius: Math.max(person.location_3d.uncertainty_radius, 0.2),
      })),
    [persons],
  );

  const floorSize = useMemo(() => {
    if (mappedPersons.length === 0) {
      return 24;
    }

    const maxExtent = Math.max(
      ...mappedPersons.flatMap((person) => [
        Math.abs(person.x),
        Math.abs(person.z),
      ]),
      8,
    );

    return Math.ceil(maxExtent / 4) * 8;
  }, [mappedPersons]);

  const cameraPosition = useMemo<[number, number, number]>(
    () => [floorSize * 0.48, floorSize * 0.34, floorSize * 0.48],
    [floorSize],
  );

  const controlsTarget = useMemo<[number, number, number]>(() => {
    if (mappedPersons.length === 0) {
      return [0, 0, 0];
    }

    const centroid = mappedPersons.reduce(
      (acc, person) => ({
        x: acc.x + person.x,
        z: acc.z + person.z,
      }),
      { x: 0, z: 0 },
    );

    return [
      centroid.x / mappedPersons.length,
      0,
      centroid.z / mappedPersons.length,
    ];
  }, [mappedPersons]);

  useEffect(() => {
    return () => {
      if (canvasRef) {
        canvasRef.current = null;
      }
    };
  }, [canvasRef]);

  return (
    <div className="absolute inset-0 size-full">
      <Canvas
        camera={{ position: cameraPosition, fov: 42, near: 0.1, far: 200 }}
        dpr={[1, 2]}
        onCreated={({ gl }) => {
          if (canvasRef) {
            canvasRef.current = gl.domElement;
          }
        }}
      >
        <ambientLight intensity={0.55} />
        <directionalLight position={[8, 14, 6]} intensity={1} />

        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, -0.001, 0]}
          receiveShadow
        >
          <planeGeometry args={[floorSize, floorSize]} />
          <meshStandardMaterial color="#f6f8fb" side={DoubleSide} />
        </mesh>

        <gridHelper
          args={[
            floorSize,
            Math.max(12, Math.floor(floorSize)),
            "#9ca3af",
            "#cbd5e1",
          ]}
          position={[0, 0, 0]}
        />

        {mappedPersons.map((person) => (
          <group key={person.id}>
            <line>
              <bufferGeometry>
                <bufferAttribute
                  attach="attributes-position"
                  args={[
                    new Float32Array([
                      person.x,
                      FLOOR_OFFSET,
                      person.z,
                      person.x,
                      person.y,
                      person.z,
                    ]),
                    3,
                  ]}
                />
              </bufferGeometry>
              <lineBasicMaterial color="#16a34a" transparent opacity={0.7} />
            </line>

            <mesh position={[person.x, person.y, person.z]} castShadow>
              <sphereGeometry args={[0.24, 24, 24]} />
              <meshStandardMaterial
                color="#22c55e"
                emissive="#15803d"
                emissiveIntensity={0.35}
              />
            </mesh>

            <mesh
              position={[person.x, FLOOR_OFFSET, person.z]}
              rotation={[-Math.PI / 2, 0, 0]}
            >
              <ringGeometry
                args={[
                  person.uncertaintyRadius * 0.8,
                  person.uncertaintyRadius,
                  48,
                ]}
              />
              <meshBasicMaterial
                color="#16a34a"
                transparent
                opacity={0.36}
                side={DoubleSide}
              />
            </mesh>
          </group>
        ))}

        <OrbitControls
          makeDefault
          target={controlsTarget}
          minPolarAngle={Math.PI / 9}
          maxPolarAngle={Math.PI / 2.02}
          minDistance={4}
          maxDistance={80}
        />
      </Canvas>

      {mappedPersons.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-medium text-muted-foreground">
          Awaiting pose stream...
        </div>
      ) : null}
    </div>
  );
}
