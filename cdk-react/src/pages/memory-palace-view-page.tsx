import {
  autoUpdate,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
} from '@floating-ui/react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import {
  Box,
  ChevronRight,
  Circle,
  Compass,
  Cone,
  Crosshair,
  Cylinder,
  Expand,
  FileUp,
  Globe,
  Minus,
  Move,
  Pencil,
  PenLine,
  Plus,
  RotateCw,
  Shapes,
  Torus,
} from 'lucide-react'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Euler,
  Group,
  LinearFilter,
  Matrix3,
  Matrix4,
  MOUSE,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  type Object3D,
  OrthographicCamera,
  Plane,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  ShaderMaterial,
  TOUCH,
  Vector2,
  Vector3,
} from 'three'
import { useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { usePageBreadcrumbs } from '@/lib/breadcrumbs'
import { getMemoryPalace, type MemoryPalaceRecord } from '@/lib/memory-palaces-api'

const NO_ACTION = -1
const TOOL_ACTIVATION_DELAY_MS = 120
const TWO_FINGER_TAP_MAX_MS = 250
const TWO_FINGER_TAP_MAX_MOVE = 12
const TWO_FINGER_PAN_REARM_MS = 450
const MAX_DEBUG_LOGS = 250
const DEGREES_PER_RADIAN = 180 / Math.PI

type ToolKind =
  | 'fake'
  | 'position'
  | 'rotation'
  | 'scale'
  | 'drawn-surface'
  | 'pen'
  | 'selected-surface'
  | 'selected-surface-orientation'
  | 'selected-surface-position'
type CameraMode = 'perspective' | 'orthographic'
type SceneMode = 'general' | 'drawn-surface' | 'selected-surface' | 'pen'
type TransformToolKind = Extract<ToolKind, 'position' | 'rotation' | 'scale'>
type GizmoAxis = 'x' | 'y' | 'z'
type CameraAlignAxis = 'right' | 'left' | 'top' | 'bottom' | 'front' | 'back'

type ToolSessionState = {
  startedAt: number
  pointerType: 'touch' | 'mouse' | 'pen'
  startPoint: { x: number; y: number }
  lastPoint: { x: number; y: number }
  updateCount: number
  worldPoint?: [number, number, number]
}

type TransformSnapshot = {
  id: string
  position: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
}

type GizmoDragState = {
  tool: TransformToolKind
  axis: GizmoAxis
  center: [number, number, number]
  orientation: [number, number, number, number]
  initialSelection: TransformSnapshot[]
  startWorldPoint: [number, number, number]
}

type ToolHandlers = {
  start: (tool: ToolKind, state: ToolSessionState, message: string) => ToolSessionState
  update: (tool: ToolKind, state: ToolSessionState, message: string) => ToolSessionState
  end: (tool: ToolKind, state: ToolSessionState, message: string) => void
  cancel: (tool: ToolKind, state: ToolSessionState, message: string) => void
}

type TransformableProperties = {
  position: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
}

type MeshPrimitiveKind = 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus'
type ImportFormat = 'stl' | 'glb' | 'fbx'

type MeshSceneObject = {
  id: string
  objectType: 'Mesh'
  primitiveType: MeshPrimitiveKind
  name: string
} & TransformableProperties & {
  mesh: {
    color: string
  }
}

type ImportedModelSceneObject = {
  id: string
  objectType: 'STL Import' | 'GLB Import' | 'FBX Import'
  primitiveType: 'imported-model'
  name: string
} & TransformableProperties & {
  importedModel: {
    format: ImportFormat
    fileName: string
    object3d: Group
  }
}

type DrawnSurfaceSceneObject = {
  id: string
  objectType: 'Drawn Surface'
  primitiveType: 'drawn-surface'
  name: string
} & TransformableProperties & {
  drawnSurface: {
    linePoints: [number, number][]
    depth: number
  }
}

type SelectedSurfaceSceneObject = {
  id: string
  objectType: 'Selected Surface'
  primitiveType: 'selected-surface'
  name: string
} & TransformableProperties & {
  selectedSurface: {
    vertices: [number, number, number][]
    indices: number[]
  }
}

type FloorCellState = 'flat' | 'mount' | 'empty'
type FloorMountDirection = 'left' | 'right' | 'up' | 'down'

type FloorSceneObject = {
  id: string
  objectType: 'Floor'
  primitiveType: 'floor'
  name: string
  floor: {
    height: number
    cells: FloorCellState[][]
    mountDirection: FloorMountDirection
  }
}

type PenSceneObject = {
  id: string
  parentId: string
  objectType: 'Pen'
  primitiveType: 'pen'
  name: string
  pen: {
    strokes: [number, number, number][][]
    strokeWidth: number
    strokeDepth: number
    cylindricalDivisions: number
  }
}

type TransformableSceneObject =
  | MeshSceneObject
  | DrawnSurfaceSceneObject
  | SelectedSurfaceSceneObject
  | ImportedModelSceneObject
type SceneObject = TransformableSceneObject | FloorSceneObject | PenSceneObject

type DrawnSurfaceDraft = {
  worldPoints: [number, number, number][]
  center: [number, number, number]
  rotation: [number, number, number]
  planeRight: [number, number, number]
  planeUp: [number, number, number]
}

type SelectedSurfaceFace = {
  key: string
  objectId: string
  worldVertices: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ]
  normal: [number, number, number]
}

type PenDraft = {
  surfaceId: string
  strokes: [number, number, number][][]
}

const FLOOR_GRID_CELLS = 10
const FLOOR_CELL_CENTER_OFFSET = (FLOOR_GRID_CELLS - 1) / 2
// New floors start as a 2x2 flat patch in the middle of the paintable 10x10 area.
const FLOOR_DEFAULT_FLAT_CELLS = 2

const createDefaultFloorCells = (): FloorCellState[][] => {
  const start = (FLOOR_GRID_CELLS - FLOOR_DEFAULT_FLAT_CELLS) / 2
  const end = start + FLOOR_DEFAULT_FLAT_CELLS
  return Array.from({ length: FLOOR_GRID_CELLS }, (_, row) =>
    Array.from({ length: FLOOR_GRID_CELLS }, (_, column) =>
      row >= start && row < end && column >= start && column < end
        ? ('flat' as FloorCellState)
        : ('empty' as FloorCellState),
    ),
  )
}

// Grid columns run left→right along +x; grid rows run top→bottom along +z
// (so "up" on the 2d grid is -z, matching the mount direction mapping).
const floorCellToWorld = (row: number, column: number): [number, number] => [
  column - FLOOR_CELL_CENTER_OFFSET,
  row - FLOOR_CELL_CENTER_OFFSET,
]

// Mount directions map to world axes: right +x, left -x, up -z, down +z.
const FLOOR_MOUNT_DIRECTION_ROTATIONS: Record<
  FloorMountDirection,
  [number, number, number]
> = {
  right: [0, 0, -Math.PI / 2],
  left: [0, 0, Math.PI / 2],
  up: [-Math.PI / 2, 0, 0],
  down: [Math.PI / 2, 0, 0],
}

const FLOOR_FLAT_COLOR = '#c6d8cb'
const FLOOR_MOUNT_COLOR = '#c2b3dd'

const MESH_PRIMITIVES: Array<{
  kind: MeshPrimitiveKind
  label: string
  icon: typeof Box
}> = [
  { kind: 'cube', label: 'Cube', icon: Box },
  { kind: 'sphere', label: 'Sphere', icon: Globe },
  { kind: 'cylinder', label: 'Cylinder', icon: Cylinder },
  { kind: 'cone', label: 'Cone', icon: Cone },
  { kind: 'torus', label: 'Torus', icon: Torus },
]

const MESH_PRIMITIVE_LABELS = Object.fromEntries(
  MESH_PRIMITIVES.map((entry) => [entry.kind, entry.label]),
) as Record<MeshPrimitiveKind, string>

const IMPORT_FORMAT_DETAILS: Record<
  ImportFormat,
  { objectType: ImportedModelSceneObject['objectType']; accept: string }
> = {
  stl: { objectType: 'STL Import', accept: '.stl' },
  glb: { objectType: 'GLB Import', accept: '.glb' },
  fbx: { objectType: 'FBX Import', accept: '.fbx' },
}

// Imported files arrive in arbitrary units (FBX is often centimeters), so wrap
// them in a container scaled to a ~2 unit footprint with the bounding-box
// bottom center at the object origin, matching the bottom-anchored primitives.
const normalizeImportedModel = (model: Object3D) => {
  const container = new Group()
  container.add(model)
  const bounds = new Box3().setFromObject(model)
  if (!bounds.isEmpty()) {
    const size = bounds.getSize(new Vector3())
    const maxDimension = Math.max(size.x, size.y, size.z)
    const scale = maxDimension > 1e-6 ? 2 / maxDimension : 1
    container.scale.setScalar(scale)
    container.position.set(
      (-(bounds.min.x + bounds.max.x) / 2) * scale,
      -bounds.min.y * scale,
      (-(bounds.min.z + bounds.max.z) / 2) * scale,
    )
  }
  return container
}

const radiansToDegrees = (value: number) => value * DEGREES_PER_RADIAN
const degreesToRadians = (value: number) => value / DEGREES_PER_RADIAN

const isTransformableObject = (object: SceneObject): object is TransformableSceneObject =>
  object.objectType === 'Mesh' ||
  object.primitiveType === 'drawn-surface' ||
  object.primitiveType === 'selected-surface' ||
  object.primitiveType === 'imported-model'

const isProjectionSurfaceObject = (
  object: SceneObject | null | undefined,
): object is DrawnSurfaceSceneObject | SelectedSurfaceSceneObject =>
  object?.primitiveType === 'drawn-surface' || object?.primitiveType === 'selected-surface'


const roundVertexValue = (value: number) => Math.round(value * 10000) / 10000

const createVertexKey = (vertex: [number, number, number]) =>
  `${roundVertexValue(vertex[0])}:${roundVertexValue(vertex[1])}:${roundVertexValue(vertex[2])}`

const createFaceKey = (
  vertices: [[number, number, number], [number, number, number], [number, number, number]],
) => vertices.map(createVertexKey).sort().join('|')

const countSharedFaceVertices = (left: SelectedSurfaceFace, right: SelectedSurfaceFace) => {
  const rightKeys = new Set(right.worldVertices.map(createVertexKey))
  return left.worldVertices.reduce(
    (count, vertex) => count + (rightKeys.has(createVertexKey(vertex)) ? 1 : 0),
    0,
  )
}

const canAppendSelectedSurfaceFace = (
  faces: SelectedSurfaceFace[],
  candidate: SelectedSurfaceFace,
) => {
  if (faces.length === 0) {
    return true
  }
  return faces.some((face) => countSharedFaceVertices(face, candidate) >= 2)
}

const getSceneModeLabel = (mode: SceneMode) =>
  mode === 'drawn-surface'
    ? 'Drawn Surface'
    : mode === 'selected-surface'
      ? 'Selected Surface'
      : mode === 'pen'
        ? 'Pen'
      : 'General'

const isSelectedSurfaceTool = (
  tool: ToolKind,
): tool is 'selected-surface' | 'selected-surface-orientation' | 'selected-surface-position' =>
  tool === 'selected-surface' ||
  tool === 'selected-surface-orientation' ||
  tool === 'selected-surface-position'

const smoothLinePoints = (points: [number, number][]) => {
  if (points.length < 4) {
    return points
  }

  let current = points

  for (let pass = 0; pass < 2; pass += 1) {
    if (current.length < 4) {
      break
    }

    const next: [number, number][] = [current[0]]
    for (let index = 0; index < current.length - 1; index += 1) {
      const start = current[index]
      const end = current[index + 1]
      next.push([
        start[0] * 0.75 + end[0] * 0.25,
        start[1] * 0.75 + end[1] * 0.25,
      ])
      next.push([
        start[0] * 0.25 + end[0] * 0.75,
        start[1] * 0.25 + end[1] * 0.75,
      ])
    }
    next.push(current[current.length - 1])
    current = next
  }

  const filtered: [number, number][] = []
  for (const point of current) {
    const previous = filtered[filtered.length - 1]
    if (!previous) {
      filtered.push(point)
      continue
    }
    const dx = point[0] - previous[0]
    const dy = point[1] - previous[1]
    if (Math.hypot(dx, dy) >= 0.01) {
      filtered.push(point)
    }
  }

  return filtered
}

const createSceneObjectId = (existingIds: Set<string>) => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  let candidate = ''
  do {
    candidate = Array.from({ length: 8 }, () => {
      const index = Math.floor(Math.random() * alphabet.length)
      return alphabet[index]
    }).join('')
  } while (existingIds.has(candidate))
  return candidate
}

function CameraControls({
  activeTool,
  selectedObjects,
  onTransformSelection,
  onToolActiveChange,
  onSelectedSurfaceFacePick,
  cameraOrientationRef,
  cameraTargetRef,
  penProjectionSurfaceId,
  sceneMode,
  toolHandlers,
}: {
  activeTool: ToolKind
  selectedObjects: TransformableSceneObject[]
  onTransformSelection: (
    dragState: GizmoDragState,
    currentWorldPoint: [number, number, number],
  ) => void
  onToolActiveChange: (active: boolean) => void
  onSelectedSurfaceFacePick: (
    tool: 'selected-surface' | 'selected-surface-orientation' | 'selected-surface-position',
    face: SelectedSurfaceFace,
  ) => void
  cameraOrientationRef: React.MutableRefObject<Quaternion>
  cameraTargetRef: React.MutableRefObject<Vector3>
  penProjectionSurfaceId: string | null
  sceneMode: SceneMode
  toolHandlers: ToolHandlers
}) {
  const { camera, gl, scene, size } = useThree()
  const controlsRef = useRef<OrbitControls | null>(null)
  const activeToolRef = useRef(activeTool)
  const toolHandlersRef = useRef(toolHandlers)
  const selectedObjectsRef = useRef(selectedObjects)
  const onTransformSelectionRef = useRef(onTransformSelection)
  const onSelectedSurfaceFacePickRef = useRef(onSelectedSurfaceFacePick)
  const sceneModeRef = useRef(sceneMode)
  const penProjectionSurfaceIdRef = useRef(penProjectionSurfaceId)
  const gestureRef = useRef({
    activeTouchMode: 'orbit' as 'orbit' | 'pan',
    lastTwoFingerTapAt: 0,
    twoFingerTouchStartedAt: 0,
    twoFingerTouchStartDistance: 0,
    twoFingerTapCandidate: false,
    pendingToolActivation: null as ReturnType<typeof window.setTimeout> | null,
    manualPanActive: false,
    manualPanLastCenter: null as Vector2 | null,
    toolSessionActive: false,
    toolSessionCommitted: false,
    latestToolPoint: null as Vector2 | null,
    toolPointerType: null as 'touch' | 'mouse' | 'pen' | null,
    primaryTouchIdentifier: null as number | null,
    orbitTouchHandoffActive: false,
    toolSessionState: null as ToolSessionState | null,
    gizmoDragState: null as GizmoDragState | null,
  })

  useEffect(() => {
    activeToolRef.current = activeTool
  }, [activeTool])

  useEffect(() => {
    toolHandlersRef.current = toolHandlers
  }, [toolHandlers])

  useEffect(() => {
    selectedObjectsRef.current = selectedObjects
  }, [selectedObjects])

  useEffect(() => {
    onTransformSelectionRef.current = onTransformSelection
  }, [onTransformSelection])

  useEffect(() => {
    onSelectedSurfaceFacePickRef.current = onSelectedSurfaceFacePick
  }, [onSelectedSurfaceFacePick])

  useEffect(() => {
    sceneModeRef.current = sceneMode
  }, [sceneMode])

  useEffect(() => {
    penProjectionSurfaceIdRef.current = penProjectionSurfaceId
  }, [penProjectionSurfaceId])

  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement)
    controls.enableDamping = true
    controls.target.x = cameraTargetRef.current.x
    controls.target.y = cameraTargetRef.current.y
    controls.target.z = cameraTargetRef.current.z
    controls.update()
    controls.mouseButtons = {
      LEFT: NO_ACTION,
      MIDDLE: MOUSE.PAN,
      RIGHT: MOUSE.ROTATE,
    }
    controls.touches = {
      ONE: NO_ACTION,
      TWO: TOUCH.DOLLY_ROTATE,
    }
    controlsRef.current = controls
    const raycaster = new Raycaster()
    const intersectionPlane = new Plane()
    const pointerNdc = new Vector2()
    const dragPoint = new Vector3()
    const cameraDirection = new Vector3()
    const axisVector = new Vector3()
    const axisHelper = new Vector3()
    const centerVector = new Vector3()
    const localQuaternion = new Quaternion()
    const localVertex = new Vector3()
    const worldVertexA = new Vector3()
    const worldVertexB = new Vector3()
    const worldVertexC = new Vector3()
    const edgeA = new Vector3()
    const edgeB = new Vector3()

    const setToolActive = (active: boolean) => {
      onToolActiveChange(active)
    }

    const computeSelectionCenter = (objects: TransformableSceneObject[]) => {
      if (objects.length === 0) {
        return null
      }
      const sum = objects.reduce(
        (current, object) => {
          current.x += object.position[0]
          current.y += object.position[1]
          current.z += object.position[2]
          return current
        },
        { x: 0, y: 0, z: 0 },
      )
      return [
        sum.x / objects.length,
        sum.y / objects.length,
        sum.z / objects.length,
      ] as [number, number, number]
    }

    const computeSelectionOrientation = (objects: TransformableSceneObject[]) => {
      if (objects.length !== 1) {
        return [0, 0, 0, 1] as [number, number, number, number]
      }
      localQuaternion.setFromEuler(
        new Euler(objects[0].rotation[0], objects[0].rotation[1], objects[0].rotation[2]),
      )
      return [
        localQuaternion.x,
        localQuaternion.y,
        localQuaternion.z,
        localQuaternion.w,
      ] as [number, number, number, number]
    }

    const updatePointerNdc = (point: Vector2) => {
      const rect = gl.domElement.getBoundingClientRect()
      pointerNdc.x = ((point.x - rect.left) / rect.width) * 2 - 1
      pointerNdc.y = -((point.y - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointerNdc, camera)
    }

    const getDrawSurfacePlaneOffset = () => {
      if ((camera as PerspectiveCamera).isPerspectiveCamera) {
        return 3
      }

      const orthographicCamera = camera as OrthographicCamera
      const visibleHeight = size.height / Math.max(orthographicCamera.zoom, 0.001)
      const equivalentPerspectiveDistance =
        visibleHeight / (2 * Math.tan((55 * Math.PI) / 360))
      const orbitDistance = Math.max(
        camera.position.distanceTo(cameraTargetRef.current),
        0.001,
      )

      return Math.max(0.05, (3 * equivalentPerspectiveDistance) / orbitDistance)
    }

    const getCameraViewPlanePoint = (point: Vector2) => {
      updatePointerNdc(point)
      camera.getWorldDirection(cameraDirection)
      intersectionPlane.setFromNormalAndCoplanarPoint(
        cameraDirection.clone(),
        camera.position.clone().addScaledVector(cameraDirection, getDrawSurfacePlaneOffset()),
      )
      return raycaster.ray.intersectPlane(intersectionPlane, dragPoint)
    }

    const getAxisVector = (
      axis: GizmoAxis,
      orientation: [number, number, number, number] = [0, 0, 0, 1],
    ) => {
      if (axis === 'x') {
        axisVector.set(1, 0, 0)
      } else if (axis === 'y') {
        axisVector.set(0, 1, 0)
      } else {
        axisVector.set(0, 0, 1)
      }
      localQuaternion.set(
        orientation[0],
        orientation[1],
        orientation[2],
        orientation[3],
      )
      return axisVector.applyQuaternion(localQuaternion)
    }

    const getDragPlaneNormal = (
      axis: GizmoAxis,
      orientation: [number, number, number, number],
    ) => {
      const axisDir = getAxisVector(axis, orientation).clone()
      camera.getWorldDirection(cameraDirection)
      axisHelper.copy(cameraDirection).cross(axisDir)
      if (axisHelper.lengthSq() < 1e-6) {
        axisHelper.set(axis === 'x' ? 0 : 1, axis === 'y' ? 0 : 1, axis === 'z' ? 0 : 1)
      }
      return axisHelper.cross(axisDir).normalize()
    }

    const getWorldPointOnDragPlane = (
      point: Vector2,
      center: [number, number, number],
      axis: GizmoAxis,
      orientation: [number, number, number, number],
    ) => {
      updatePointerNdc(point)
      intersectionPlane.setFromNormalAndCoplanarPoint(
        getDragPlaneNormal(axis, orientation),
        centerVector.set(center[0], center[1], center[2]),
      )
      return raycaster.ray.intersectPlane(intersectionPlane, dragPoint)
    }

    const getRotationPlanePoint = (
      point: Vector2,
      center: [number, number, number],
      axis: GizmoAxis,
      orientation: [number, number, number, number],
    ) => {
      updatePointerNdc(point)
      intersectionPlane.setFromNormalAndCoplanarPoint(
        getAxisVector(axis, orientation).clone(),
        centerVector.set(center[0], center[1], center[2]),
      )
      return raycaster.ray.intersectPlane(intersectionPlane, dragPoint)
    }

    const getTransformHandleHit = (point: Vector2) => {
      if (activeToolRef.current === 'fake' || selectedObjectsRef.current.length === 0) {
        return null
      }

      updatePointerNdc(point)
      const intersections = raycaster.intersectObjects(scene.children, true)
      const hit = intersections.find((entry) => {
        const handle = entry.object.userData.gizmoHandle as
          | { tool: TransformToolKind; axis: GizmoAxis }
          | undefined
        return handle?.tool === activeToolRef.current
      })
      return hit?.object.userData.gizmoHandle as
        | { tool: TransformToolKind; axis: GizmoAxis }
        | undefined
        | null
    }

    const getSelectedSurfaceFaceHit = (point: Vector2) => {
      updatePointerNdc(point)
      const intersections = raycaster.intersectObjects(scene.children, true)
      const hit = intersections.find((entry) => {
        const sceneObjectId = entry.object.userData.sceneObjectId as string | undefined
        return (
          !!sceneObjectId &&
          !entry.object.userData.gizmoHandle &&
          (entry.face?.a ?? null) !== null &&
          (entry.face?.b ?? null) !== null &&
          (entry.face?.c ?? null) !== null
        )
      })

      if (!hit?.face) {
        return null
      }

      const hitObject = hit.object
      const sceneObject = hitObject as typeof hitObject & {
        geometry?: {
          getAttribute: (name: string) => any
        }
      }
      const sceneObjectId = sceneObject.userData.sceneObjectId as string | undefined
      const geometry = sceneObject.geometry
      if (!sceneObjectId || !geometry) {
        return null
      }
      const positionAttribute = geometry.getAttribute('position')
      if (!positionAttribute) {
        return null
      }

      const readWorldVertex = (index: number, target: Vector3) => {
        localVertex.fromBufferAttribute(positionAttribute, index)
        return target.copy(localVertex).applyMatrix4(sceneObject.matrixWorld)
      }

      readWorldVertex(hit.face.a, worldVertexA)
      readWorldVertex(hit.face.b, worldVertexB)
      readWorldVertex(hit.face.c, worldVertexC)
      edgeA.subVectors(worldVertexB, worldVertexA)
      edgeB.subVectors(worldVertexC, worldVertexA)
      const normal = edgeA.clone().cross(edgeB).normalize()

      const vertices: [
        [number, number, number],
        [number, number, number],
        [number, number, number],
      ] = [
        [worldVertexA.x, worldVertexA.y, worldVertexA.z],
        [worldVertexB.x, worldVertexB.y, worldVertexB.z],
        [worldVertexC.x, worldVertexC.y, worldVertexC.z],
      ]

      return {
        key: `${sceneObjectId}:${createFaceKey(vertices)}`,
        objectId: sceneObjectId,
        worldVertices: vertices,
        normal: [normal.x, normal.y, normal.z] as [number, number, number],
      } satisfies SelectedSurfaceFace
    }

    const getPenProjectionPoint = (point: Vector2) => {
      const targetId = penProjectionSurfaceIdRef.current
      if (!targetId) {
        return null
      }
      updatePointerNdc(point)
      const intersections = raycaster.intersectObjects(scene.children, true)
      const hit = intersections.find((entry) => {
        const sceneObjectId = entry.object.userData.sceneObjectId as string | undefined
        return sceneObjectId === targetId
      })
      if (!hit?.point) {
        return null
      }
      return hit.point
    }

    const startToolSession = (
      pointerType: 'touch' | 'mouse' | 'pen',
      point: Vector2,
      message: string,
      primaryTouchIdentifier: number | null = null,
    ) => {
      if (activeToolRef.current === 'fake') {
        setToolActive(false)
        return
      }
      clearPendingToolActivation()
      const transformHandle = getTransformHandleHit(point)
      let gizmoDragState: GizmoDragState | null = null
      if (transformHandle) {
        const center = computeSelectionCenter(selectedObjectsRef.current)
        const orientation = computeSelectionOrientation(selectedObjectsRef.current)
        const worldPoint =
          center === null
            ? null
            : transformHandle.tool === 'rotation'
              ? getRotationPlanePoint(point, center, transformHandle.axis, orientation)
              : getWorldPointOnDragPlane(point, center, transformHandle.axis, orientation)
        if (center && worldPoint) {
          gizmoDragState = {
            tool: transformHandle.tool,
            axis: transformHandle.axis,
            center,
            orientation,
            initialSelection: selectedObjectsRef.current.map((object) => ({
              id: object.id,
              position: [...object.position],
              rotation: [...object.rotation],
              scale: [...object.scale],
            })),
            startWorldPoint: [worldPoint.x, worldPoint.y, worldPoint.z],
          }
        }
      }
      const drawnSurfacePoint =
        sceneModeRef.current === 'drawn-surface' &&
        activeToolRef.current === 'drawn-surface'
          ? getCameraViewPlanePoint(point)
          : sceneModeRef.current === 'pen' && activeToolRef.current === 'pen'
            ? getPenProjectionPoint(point)
            : null
      gestureRef.current.toolSessionActive = true
      gestureRef.current.toolSessionCommitted = pointerType !== 'touch'
      gestureRef.current.latestToolPoint = point
      gestureRef.current.toolPointerType = pointerType
      gestureRef.current.primaryTouchIdentifier = primaryTouchIdentifier
      gestureRef.current.gizmoDragState = gizmoDragState
      const nextState = toolHandlersRef.current.start(
        activeToolRef.current,
        {
          startedAt: performance.now(),
          pointerType,
          startPoint: { x: point.x, y: point.y },
          lastPoint: { x: point.x, y: point.y },
          updateCount: 0,
          worldPoint: drawnSurfacePoint
            ? [drawnSurfacePoint.x, drawnSurfacePoint.y, drawnSurfacePoint.z]
            : undefined,
        },
        message,
      )
      gestureRef.current.toolSessionState = nextState
      controls.enabled = false
      setToolActive(true)

      if (pointerType === 'touch') {
        gestureRef.current.pendingToolActivation = window.setTimeout(() => {
          gestureRef.current.pendingToolActivation = null
          if (gestureRef.current.toolSessionActive) {
            gestureRef.current.toolSessionCommitted = true
          }
        }, TOOL_ACTIVATION_DELAY_MS)
      }
    }

    const updateToolSession = (point: Vector2, message: string) => {
      if (!gestureRef.current.toolSessionActive) {
        return
      }
      gestureRef.current.latestToolPoint = point
      if (gestureRef.current.gizmoDragState) {
        const dragState = gestureRef.current.gizmoDragState
        const worldPoint =
          dragState.tool === 'rotation'
            ? getRotationPlanePoint(
                point,
                dragState.center,
                dragState.axis,
                dragState.orientation,
              )
            : getWorldPointOnDragPlane(
                point,
                dragState.center,
                dragState.axis,
                dragState.orientation,
              )
        if (worldPoint) {
          onTransformSelectionRef.current(dragState, [
            worldPoint.x,
            worldPoint.y,
            worldPoint.z,
          ])
        }
      }
      if (gestureRef.current.toolSessionState) {
        const drawnSurfacePoint =
          sceneModeRef.current === 'drawn-surface' &&
          activeToolRef.current === 'drawn-surface'
            ? getCameraViewPlanePoint(point)
            : sceneModeRef.current === 'pen' && activeToolRef.current === 'pen'
              ? getPenProjectionPoint(point)
              : null
        gestureRef.current.toolSessionState.lastPoint = { x: point.x, y: point.y }
        gestureRef.current.toolSessionState.updateCount += 1
        gestureRef.current.toolSessionState.worldPoint = drawnSurfacePoint
          ? [drawnSurfacePoint.x, drawnSurfacePoint.y, drawnSurfacePoint.z]
          : gestureRef.current.toolSessionState.worldPoint
        gestureRef.current.toolSessionState = toolHandlersRef.current.update(
          activeToolRef.current,
          gestureRef.current.toolSessionState,
          message,
        )
      }
    }

    const cancelToolSession = (message: string) => {
      if (!gestureRef.current.toolSessionActive) {
        return
      }
      clearPendingToolActivation()
      gestureRef.current.toolSessionActive = false
      gestureRef.current.toolSessionCommitted = false
      gestureRef.current.latestToolPoint = null
      gestureRef.current.toolPointerType = null
      gestureRef.current.primaryTouchIdentifier = null
      gestureRef.current.gizmoDragState = null
      const toolSessionState = gestureRef.current.toolSessionState
      gestureRef.current.toolSessionState = null
      controls.enabled = true
      setToolActive(false)
      if (toolSessionState) {
        toolHandlersRef.current.cancel(activeToolRef.current, toolSessionState, message)
      }
    }

    const endToolSession = (message: string) => {
      if (!gestureRef.current.toolSessionActive) {
        return
      }
      clearPendingToolActivation()
      gestureRef.current.toolSessionActive = false
      gestureRef.current.toolSessionCommitted = false
      gestureRef.current.latestToolPoint = null
      gestureRef.current.toolPointerType = null
      gestureRef.current.primaryTouchIdentifier = null
      gestureRef.current.gizmoDragState = null
      const toolSessionState = gestureRef.current.toolSessionState
      gestureRef.current.toolSessionState = null
      controls.enabled = true
      setToolActive(false)
      if (toolSessionState) {
        toolHandlersRef.current.end(activeToolRef.current, toolSessionState, message)
      }
    }

    const clearPendingToolActivation = () => {
      if (gestureRef.current.pendingToolActivation !== null) {
        window.clearTimeout(gestureRef.current.pendingToolActivation)
        gestureRef.current.pendingToolActivation = null
      }
    }

    const resetOrbitTouchMode = () => {
      gestureRef.current.activeTouchMode = 'orbit'
      gestureRef.current.twoFingerTouchStartedAt = 0
      gestureRef.current.twoFingerTouchStartDistance = 0
      gestureRef.current.twoFingerTapCandidate = false
      gestureRef.current.manualPanActive = false
      gestureRef.current.manualPanLastCenter = null
      gestureRef.current.orbitTouchHandoffActive = false
      controls.enabled = true
      controls.touches = {
        ONE: NO_ACTION,
        TWO: TOUCH.DOLLY_ROTATE,
      }
    }

    const clearOrbitControlPointers = () => {
      const controlsInstance = controlsRef.current as
        | (OrbitControls & {
            _pointers?: number[]
            _pointerPositions?: Record<number, Vector2>
            state?: number
          })
        | null
      if (!controlsInstance) {
        return
      }
      if (controlsInstance._pointers) {
        controlsInstance._pointers.length = 0
      }
      if (controlsInstance._pointerPositions) {
        Object.keys(controlsInstance._pointerPositions).forEach((key) => {
          delete controlsInstance._pointerPositions?.[Number(key)]
        })
      }
      if ('state' in controlsInstance) {
        controlsInstance.state = -1
      }
    }

    const startOrbitTouchHandoff = (touches: TouchList) => {
      const controlsInstance = controlsRef.current as
        | (OrbitControls & {
            _addPointer?: (event: { pointerId: number }) => void
            _onTouchStart?: (event: {
              pointerId: number
              pageX: number
              pageY: number
            }) => void
          })
        | null

      if (!controlsInstance || touches.length < 2) {
        return
      }

      clearOrbitControlPointers()
      gestureRef.current.orbitTouchHandoffActive = true

      for (let index = 0; index < 2; index += 1) {
        const touch = touches[index]
        controlsInstance._addPointer?.({ pointerId: touch.identifier })
        controlsInstance._onTouchStart?.({
          pointerId: touch.identifier,
          pageX: touch.pageX,
          pageY: touch.pageY,
        })
      }
    }

    const updateOrbitTouchHandoff = (touches: TouchList) => {
      const controlsInstance = controlsRef.current as
        | (OrbitControls & {
            _onTouchMove?: (event: {
              pointerId: number
              pageX: number
              pageY: number
            }) => void
          })
        | null

      if (!controlsInstance || touches.length < 2) {
        return
      }

      for (let index = 0; index < 2; index += 1) {
        const touch = touches[index]
        controlsInstance._onTouchMove?.({
          pointerId: touch.identifier,
          pageX: touch.pageX,
          pageY: touch.pageY,
        })
      }
    }

    const endOrbitTouchHandoff = () => {
      gestureRef.current.orbitTouchHandoffActive = false
      clearOrbitControlPointers()
    }

    const getTwoFingerDistance = (touches: TouchList) => {
      if (touches.length < 2) {
        return 0
      }
      const dx = touches[0].clientX - touches[1].clientX
      const dy = touches[0].clientY - touches[1].clientY
      return Math.hypot(dx, dy)
    }

    const getTwoFingerCenter = (touches: TouchList) => {
      if (touches.length < 2) {
        return new Vector2()
      }
      return new Vector2(
        (touches[0].clientX + touches[1].clientX) / 2,
        (touches[0].clientY + touches[1].clientY) / 2,
      )
    }

    const getTrackedTouch = (touches: TouchList) => {
      const identifier = gestureRef.current.primaryTouchIdentifier
      if (identifier === null) {
        return touches.length > 0 ? touches[0] : null
      }
      for (let index = 0; index < touches.length; index += 1) {
        if (touches[index].identifier === identifier) {
          return touches[index]
        }
      }
      return null
    }

    const applyManualPan = (deltaX: number, deltaY: number) => {
      const canvas = gl.domElement
      const controlsInstance = controlsRef.current
      if (!controlsInstance) {
        return
      }
      let panX = 0
      let panY = 0

      if ((camera as PerspectiveCamera).isPerspectiveCamera) {
        const perspectiveCamera = camera as PerspectiveCamera
        const offsetVector = new Vector3()
        offsetVector.subVectors(
          perspectiveCamera.position,
          new Vector3(
            controlsInstance.target.x,
            controlsInstance.target.y,
            controlsInstance.target.z,
          ),
        )
        const targetDistance =
          offsetVector.length() * Math.tan((perspectiveCamera.fov * Math.PI) / 360)

        panX = (2 * deltaX * targetDistance) / canvas.clientHeight
        panY = (2 * deltaY * targetDistance) / canvas.clientHeight
      } else if ((camera as OrthographicCamera).isOrthographicCamera) {
        const orthographicCamera = camera as OrthographicCamera
        panX =
          (deltaX * (orthographicCamera.right - orthographicCamera.left)) /
          orthographicCamera.zoom /
          canvas.clientWidth
        panY =
          (deltaY * (orthographicCamera.top - orthographicCamera.bottom)) /
          orthographicCamera.zoom /
          canvas.clientHeight
      }

      const pan = new Vector3()
      const up = new Vector3()
      const right = new Vector3()

      up.copy(camera.up).setLength(panY)
      right.setFromMatrixColumn(camera.matrix, 0).setLength(-panX)
      pan.copy(right).add(up)

      camera.position.add(pan)
      controlsInstance.target.add(pan)
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (
        (event.pointerType === 'mouse' || event.pointerType === 'pen') &&
        event.button === 0
      ) {
        if (
          sceneModeRef.current === 'selected-surface' &&
          isSelectedSurfaceTool(activeToolRef.current)
        ) {
          const face = getSelectedSurfaceFaceHit(new Vector2(event.clientX, event.clientY))
          if (face) {
            onSelectedSurfaceFacePickRef.current(activeToolRef.current, face)
          }
          return
        }
        startToolSession(
          event.pointerType,
          new Vector2(event.clientX, event.clientY),
          `${event.pointerType} start called`,
        )
      }
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (
        gestureRef.current.toolSessionActive &&
        gestureRef.current.toolPointerType === event.pointerType &&
        (event.pointerType === 'mouse' || event.pointerType === 'pen')
      ) {
        updateToolSession(
          new Vector2(event.clientX, event.clientY),
          `${event.pointerType} update called (${Math.round(event.clientX)}, ${Math.round(event.clientY)})`,
        )
      }
    }

    const handlePointerUp = (event: PointerEvent) => {
      if (
        (event.pointerType === 'mouse' || event.pointerType === 'pen') &&
        gestureRef.current.toolPointerType === event.pointerType
      ) {
        endToolSession(`${event.pointerType} end called`)
      }
    }

    const handleTouchStart = (event: TouchEvent) => {
      const now = performance.now()

      if (event.touches.length === 1) {
        const touch = event.touches[0]
        if (
          sceneModeRef.current === 'selected-surface' &&
          isSelectedSurfaceTool(activeToolRef.current)
        ) {
          const face = getSelectedSurfaceFaceHit(new Vector2(touch.clientX, touch.clientY))
          if (face) {
            onSelectedSurfaceFacePickRef.current(activeToolRef.current, face)
          }
          return
        }
        if (!gestureRef.current.toolSessionActive) {
          startToolSession(
            'touch',
            new Vector2(touch.clientX, touch.clientY),
            `touch start called (${Math.round(touch.clientX)}, ${Math.round(touch.clientY)})`,
            touch.identifier,
          )
        }
        return
      }

      if (
        gestureRef.current.toolSessionActive &&
        gestureRef.current.toolPointerType === 'touch'
      ) {
        if (!gestureRef.current.toolSessionCommitted) {
          cancelToolSession('touch cancel called (switching to orbit)')
          resetOrbitTouchMode()
          startOrbitTouchHandoff(event.touches)
        } else {
          setToolActive(true)
          return
        }
      } else {
        clearPendingToolActivation()
        setToolActive(false)
      }

      if (event.touches.length === 2) {
        const isPanGesture =
          now - gestureRef.current.lastTwoFingerTapAt <= TWO_FINGER_PAN_REARM_MS

        gestureRef.current.activeTouchMode = isPanGesture ? 'pan' : 'orbit'
        gestureRef.current.twoFingerTouchStartedAt = now
        gestureRef.current.twoFingerTouchStartDistance = getTwoFingerDistance(
          event.touches,
        )
        gestureRef.current.twoFingerTapCandidate = true

        controls.touches = {
          ONE: NO_ACTION,
          TWO: TOUCH.DOLLY_ROTATE,
        }

        if (isPanGesture) {
          gestureRef.current.manualPanActive = true
          gestureRef.current.manualPanLastCenter = getTwoFingerCenter(event.touches)
          controls.enabled = false
        } else {
          gestureRef.current.manualPanActive = false
          gestureRef.current.manualPanLastCenter = null
          controls.enabled = true
        }
      }
    }

    const handleTouchMove = (event: TouchEvent) => {
      if (
        gestureRef.current.toolSessionActive &&
        gestureRef.current.toolPointerType === 'touch'
      ) {
        const trackedTouch = getTrackedTouch(event.touches)
        if (trackedTouch) {
          updateToolSession(
            new Vector2(trackedTouch.clientX, trackedTouch.clientY),
            `touch update called (${Math.round(trackedTouch.clientX)}, ${Math.round(trackedTouch.clientY)})`,
          )
        }
        if (
          event.touches.length > 1 &&
          gestureRef.current.toolSessionCommitted
        ) {
          return
        }
      }

      if (gestureRef.current.manualPanActive && event.touches.length === 2) {
        const nextCenter = getTwoFingerCenter(event.touches)
        const previousCenter = gestureRef.current.manualPanLastCenter
        if (previousCenter) {
          applyManualPan(nextCenter.x - previousCenter.x, nextCenter.y - previousCenter.y)
        }
        gestureRef.current.manualPanLastCenter = nextCenter
        gestureRef.current.twoFingerTapCandidate = false
        return
      }

      if (
        gestureRef.current.orbitTouchHandoffActive &&
        gestureRef.current.activeTouchMode === 'orbit' &&
        event.touches.length === 2
      ) {
        updateOrbitTouchHandoff(event.touches)
      }

      if (event.touches.length !== 2 || !gestureRef.current.twoFingerTapCandidate) {
        return
      }
      const distance = getTwoFingerDistance(event.touches)
      const delta = Math.abs(distance - gestureRef.current.twoFingerTouchStartDistance)
      if (delta > TWO_FINGER_TAP_MAX_MOVE) {
        gestureRef.current.twoFingerTapCandidate = false
      }
    }

    const handleTouchEnd = (event: TouchEvent) => {
      const now = performance.now()
      const didJustFinishTwoFingerTap =
        event.touches.length < 2 &&
        gestureRef.current.twoFingerTapCandidate &&
        gestureRef.current.twoFingerTouchStartedAt > 0 &&
        now - gestureRef.current.twoFingerTouchStartedAt <= TWO_FINGER_TAP_MAX_MS

      if (event.touches.length === 0) {
        if (
          gestureRef.current.toolSessionActive &&
          gestureRef.current.toolPointerType === 'touch'
        ) {
          endToolSession('touch end called')
        } else {
          clearPendingToolActivation()
          setToolActive(false)
        }
      }

      if (didJustFinishTwoFingerTap) {
        gestureRef.current.lastTwoFingerTapAt = now
      }

      if (event.touches.length < 2) {
        endOrbitTouchHandoff()
        resetOrbitTouchMode()
      }

      if (
        event.touches.length === 1 &&
        gestureRef.current.toolSessionActive &&
        gestureRef.current.toolPointerType === 'touch'
      ) {
        setToolActive(true)
      }
    }

    const handleTouchCancel = () => {
      if (
        gestureRef.current.toolSessionActive &&
        gestureRef.current.toolPointerType === 'touch'
      ) {
        cancelToolSession('touch cancel called')
      } else {
        clearPendingToolActivation()
        setToolActive(false)
      }
      endOrbitTouchHandoff()
      resetOrbitTouchMode()
    }

    const element = gl.domElement
    element.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    element.addEventListener('touchstart', handleTouchStart, { passive: true })
    element.addEventListener('touchmove', handleTouchMove, { passive: true })
    element.addEventListener('touchend', handleTouchEnd, { passive: true })
    element.addEventListener('touchcancel', handleTouchCancel, { passive: true })

    return () => {
      clearPendingToolActivation()
      controls.dispose()
      element.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
      element.removeEventListener('touchstart', handleTouchStart)
      element.removeEventListener('touchmove', handleTouchMove)
      element.removeEventListener('touchend', handleTouchEnd)
      element.removeEventListener('touchcancel', handleTouchCancel)
    }
  }, [camera, cameraTargetRef, gl.domElement, onToolActiveChange, scene, size.height])

  useFrame(() => {
    controlsRef.current?.update()
    cameraOrientationRef.current.copy(camera.quaternion)
    if (controlsRef.current) {
      cameraTargetRef.current.copy(controlsRef.current.target)
    }
  })

  return null
}

function SceneCameraRig({
  cameraMode,
  cameraTargetRef,
  cameraAlignRequest,
}: {
  cameraMode: CameraMode
  cameraTargetRef: React.MutableRefObject<Vector3>
  cameraAlignRequest: { axis: CameraAlignAxis; nonce: number } | null
}) {
  const perspectiveCameraRef = useRef<PerspectiveCamera | null>(null)
  const orthographicCameraRef = useRef<OrthographicCamera | null>(null)
  const { camera, set, size } = useThree()
  const forwardVector = useRef(new Vector3()).current

  useEffect(() => {
    const orthographicCamera = orthographicCameraRef.current
    if (!orthographicCamera) {
      return
    }
    orthographicCamera.left = size.width / -2
    orthographicCamera.right = size.width / 2
    orthographicCamera.top = size.height / 2
    orthographicCamera.bottom = size.height / -2
    orthographicCamera.updateProjectionMatrix()
  }, [size.height, size.width])

  useEffect(() => {
    const perspectiveCamera = perspectiveCameraRef.current
    const orthographicCamera = orthographicCameraRef.current
    if (!perspectiveCamera || !orthographicCamera) {
      return
    }

    const nextCamera =
      cameraMode === 'perspective' ? perspectiveCamera : orthographicCamera

    nextCamera.up.copy(camera.up)
    const distanceToTarget = camera.position.distanceTo(cameraTargetRef.current)
    camera.getWorldDirection(forwardVector)

    if (
      cameraMode === 'orthographic' &&
      (camera as PerspectiveCamera).isPerspectiveCamera
    ) {
      orthographicCamera.position.copy(camera.position)
      orthographicCamera.quaternion.copy(camera.quaternion)
      const visibleHeight =
        2 *
        Math.max(distanceToTarget, 0.001) *
        Math.tan((((camera as PerspectiveCamera).fov ?? perspectiveCamera.fov) * Math.PI) / 360)
      orthographicCamera.zoom = Math.max(0.01, size.height / visibleHeight)
      orthographicCamera.near = -5000
      orthographicCamera.far = 5000
      orthographicCamera.updateProjectionMatrix()
    }

    if (
      cameraMode === 'perspective' &&
      (camera as OrthographicCamera).isOrthographicCamera
    ) {
      const orthographicCurrent = camera as OrthographicCamera
      const visibleHeight = size.height / Math.max(orthographicCurrent.zoom, 0.001)
      const nextDistance =
        visibleHeight / (2 * Math.tan((perspectiveCamera.fov * Math.PI) / 360))
      perspectiveCamera.position
        .copy(cameraTargetRef.current)
        .addScaledVector(forwardVector, -nextDistance)
      perspectiveCamera.quaternion.copy(camera.quaternion)
    } else if (cameraMode === 'perspective') {
      perspectiveCamera.position.copy(camera.position)
      perspectiveCamera.quaternion.copy(camera.quaternion)
    }

    if (cameraMode === 'perspective') {
      perspectiveCamera.aspect = size.width / Math.max(size.height, 1)
      perspectiveCamera.near = 0.01
      perspectiveCamera.far = 5000
      perspectiveCamera.updateProjectionMatrix()
    }

    set({ camera: nextCamera })
  }, [camera, cameraMode, cameraTargetRef, set, size.height, size.width])

  useEffect(() => {
    if (!cameraAlignRequest) {
      return
    }

    const nextCamera =
      cameraMode === 'perspective'
        ? perspectiveCameraRef.current
        : orthographicCameraRef.current
    if (!nextCamera) {
      return
    }

    const target = cameraTargetRef.current.clone()
    const distance = Math.max(nextCamera.position.distanceTo(target), 0.001)
    const currentUp = nextCamera.up.clone().normalize()
    const direction =
      cameraAlignRequest.axis === 'right'
        ? new Vector3(1, 0, 0)
        : cameraAlignRequest.axis === 'left'
          ? new Vector3(-1, 0, 0)
          : cameraAlignRequest.axis === 'top'
            ? new Vector3(0, 1, 0)
            : cameraAlignRequest.axis === 'bottom'
              ? new Vector3(0, -1, 0)
              : cameraAlignRequest.axis === 'front'
                ? new Vector3(0, 0, 1)
                : new Vector3(0, 0, -1)

    nextCamera.position.copy(target).addScaledVector(direction, distance)
    const projectedUp = currentUp
      .clone()
      .projectOnPlane(direction)
      .normalize()
    if (projectedUp.lengthSq() < 1e-6) {
      projectedUp.set(0, 1, 0).projectOnPlane(direction).normalize()
    }
    nextCamera.up.copy(projectedUp)
    nextCamera.lookAt(target)
    nextCamera.updateProjectionMatrix()
    set({ camera: nextCamera })
  }, [cameraAlignRequest, cameraMode, cameraTargetRef, set])

  return (
    <>
      <perspectiveCamera
        ref={perspectiveCameraRef}
        position={[3, 3, 3]}
        fov={55}
        near={0.01}
        far={5000}
      />
      <orthographicCamera
        ref={orthographicCameraRef}
        position={[3, 3, 3]}
        near={-5000}
        far={5000}
        zoom={90}
      />
    </>
  )
}

function SceneObjects({
  objects,
  selectedIds,
}: {
  objects: SceneObject[]
  selectedIds: Set<string>
}) {
  const objectById = new Map(objects.map((object) => [object.id, object] as const))

  return (
    <>
      {objects.map((object) => {
        if (object.primitiveType === 'pen') {
          return null
        }

        if (object.objectType === 'Mesh') {
          return (
            <group
              key={object.id}
              position={object.position}
              rotation={object.rotation}
              scale={object.scale}
            >
              {/* Geometry is raised so the object origin sits at the bottom:
                  position y = 0 rests the primitive on the floor. */}
              <mesh
                position={[0, object.primitiveType === 'torus' ? 0.15 : 0.5, 0]}
                rotation={
                  object.primitiveType === 'torus' ? [-Math.PI / 2, 0, 0] : [0, 0, 0]
                }
                userData={{ sceneObjectId: object.id }}
              >
                {object.primitiveType === 'cube' ? <boxGeometry args={[1, 1, 1]} /> : null}
                {object.primitiveType === 'sphere' ? (
                  <sphereGeometry args={[0.5, 32, 16]} />
                ) : null}
                {object.primitiveType === 'cylinder' ? (
                  <cylinderGeometry args={[0.5, 0.5, 1, 32]} />
                ) : null}
                {object.primitiveType === 'cone' ? <coneGeometry args={[0.5, 1, 32]} /> : null}
                {object.primitiveType === 'torus' ? (
                  <torusGeometry args={[0.35, 0.15, 16, 48]} />
                ) : null}
                <meshStandardMaterial
                  color={selectedIds.has(object.id) ? '#7fd68f' : object.mesh.color}
                  roughness={0.82}
                  metalness={0.08}
                />
              </mesh>
            </group>
          )
        }

        if (object.primitiveType === 'imported-model') {
          return (
            <group
              key={object.id}
              position={object.position}
              rotation={object.rotation}
              scale={object.scale}
            >
              <primitive object={object.importedModel.object3d} />
            </group>
          )
        }

        if (object.primitiveType === 'drawn-surface') {
          const positions = new Float32Array(
            object.drawnSurface.linePoints.flatMap(([x, y]) => [
              object.drawnSurface.depth / 2,
              y,
              x,
              -object.drawnSurface.depth / 2,
              y,
              x,
            ]),
          )
          const indices = object.drawnSurface.linePoints
            .slice(0, -1)
            .flatMap((_, index) => {
              const base = index * 2
              return [base, base + 1, base + 2, base + 1, base + 3, base + 2]
            })
          return (
            <group
              key={object.id}
              position={object.position}
              rotation={object.rotation}
              scale={object.scale}
            >
              <mesh userData={{ sceneObjectId: object.id }}>
                <bufferGeometry>
                  <bufferAttribute
                    attach="attributes-position"
                    args={[positions, 3]}
                  />
                  <bufferAttribute
                    attach="index"
                    args={[new Uint16Array(indices), 1]}
                  />
                </bufferGeometry>
                <meshStandardMaterial
                  color={selectedIds.has(object.id) ? '#b88cff' : '#8656d9'}
                  roughness={0.86}
                  metalness={0.04}
                  side={DoubleSide}
                  transparent
                  opacity={0.6}
                />
              </mesh>
            </group>
          )
        }

        if (object.primitiveType === 'selected-surface') {
          return (
            <group
              key={object.id}
              position={object.position}
              rotation={object.rotation}
              scale={object.scale}
            >
              <mesh renderOrder={-10} userData={{ sceneObjectId: object.id }}>
                <bufferGeometry>
                  <bufferAttribute
                    attach="attributes-position"
                    args={[new Float32Array(object.selectedSurface.vertices.flat()), 3]}
                  />
                  <bufferAttribute
                    attach="index"
                    args={[new Uint16Array(object.selectedSurface.indices), 1]}
                  />
                </bufferGeometry>
                <meshStandardMaterial
                  color={selectedIds.has(object.id) ? '#d7b2ff' : '#9b6bff'}
                  emissive={selectedIds.has(object.id) ? '#3c235f' : '#231137'}
                  roughness={0.84}
                  metalness={0.03}
                  side={DoubleSide}
                  transparent
                  opacity={0.5}
                  polygonOffset
                polygonOffsetFactor={-1}
                polygonOffsetUnits={-1}
              />
              </mesh>
            </group>
          )
        }

        return (
          <group key={object.id}>
            {object.floor.cells.map((cellRow, rowIndex) =>
              cellRow.map((cell, columnIndex) => {
                if (cell === 'empty') {
                  return null
                }
                const [cellX, cellZ] = floorCellToWorld(rowIndex, columnIndex)
                return (
                  <group key={`${object.id}-${rowIndex}-${columnIndex}`}>
                    <mesh
                      position={[cellX, -object.floor.height / 2, cellZ]}
                      receiveShadow
                    >
                      <boxGeometry args={[1, object.floor.height, 1]} />
                      <meshStandardMaterial
                        color={cell === 'mount' ? FLOOR_MOUNT_COLOR : FLOOR_FLAT_COLOR}
                        roughness={0.92}
                        metalness={0.02}
                      />
                    </mesh>
                    <mesh
                      position={[cellX, 0.001, cellZ]}
                      rotation={[-Math.PI / 2, 0, 0]}
                      receiveShadow
                    >
                      <planeGeometry args={[1, 1]} />
                      <FloorGridMaterial
                        selected={selectedIds.has(object.id)}
                        mount={cell === 'mount'}
                      />
                    </mesh>
                    {cell === 'mount' ? (
                      <mesh
                        position={[cellX, 0.12, cellZ]}
                        rotation={FLOOR_MOUNT_DIRECTION_ROTATIONS[object.floor.mountDirection]}
                      >
                        <coneGeometry args={[0.1, 0.32, 12]} />
                        <meshStandardMaterial color="#8656d9" emissive="#2a1747" />
                      </mesh>
                    ) : null}
                  </group>
                )
              }),
            )}
          </group>
        )
      })}
      {objects
        .filter((object): object is PenSceneObject => object.primitiveType === 'pen')
        .map((penObject) => {
          const parentObject = objectById.get(penObject.parentId)
          if (!parentObject || !isProjectionSurfaceObject(parentObject)) {
            return null
          }
          return (
            <PenObjectMeshes
              key={penObject.id}
              penObject={penObject}
              parentObject={parentObject}
              selected={selectedIds.has(penObject.id)}
            />
          )
        })}
    </>
  )
}

function DrawnSurfaceDraftLine({
  draft,
}: {
  draft: DrawnSurfaceDraft | null
}) {
  if (!draft || draft.worldPoints.length === 0) {
    return null
  }

  return (
    <group renderOrder={1000}>
      {draft.worldPoints.map((point, index) => (
        <mesh
          key={`draft-point-${index}`}
          position={point}
          renderOrder={1000}
        >
          <sphereGeometry args={[0.035, 10, 10]} />
          <meshBasicMaterial color="#a8f0b9" depthTest={false} depthWrite={false} />
        </mesh>
      ))}
      {draft.worldPoints.slice(0, -1).map((point, index) => {
        const nextPoint = draft.worldPoints[index + 1]
        const start = new Vector3(...point)
        const end = new Vector3(...nextPoint)
        const direction = end.clone().sub(start)
        const length = direction.length()
        if (length < 1e-6) {
          return null
        }
        const midpoint = start.clone().add(end).multiplyScalar(0.5)
        const quaternion = new Quaternion().setFromUnitVectors(
          new Vector3(0, 1, 0),
          direction.clone().normalize(),
        )

        return (
          <mesh
            key={`draft-segment-${index}`}
            position={[midpoint.x, midpoint.y, midpoint.z]}
            quaternion={quaternion}
            renderOrder={1000}
          >
            <cylinderGeometry args={[0.02, 0.02, length, 8]} />
            <meshBasicMaterial color="#a8f0b9" depthTest={false} depthWrite={false} />
          </mesh>
        )
      })}
    </group>
  )
}

function SelectedSurfaceDraftOverlay({
  faces,
  color = '#b98bff',
  opacity = 0.45,
}: {
  faces: SelectedSurfaceFace[]
  color?: string
  opacity?: number
}) {
  if (faces.length === 0) {
    return null
  }

  return (
    <group renderOrder={1100}>
      {faces.map((face) => {
        const positions = new Float32Array(face.worldVertices.flat())
        return (
          <mesh key={face.key} renderOrder={1100}>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" args={[positions, 3]} />
              <bufferAttribute attach="index" args={[new Uint16Array([0, 1, 2]), 1]} />
            </bufferGeometry>
            <meshBasicMaterial
              color={color}
              transparent
              opacity={opacity}
              side={DoubleSide}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
        )
      })}
    </group>
  )
}

function PenStrokeMeshes({
  strokes,
  strokeWidth,
  strokeDepth,
  cylindricalDivisions,
  color,
  parentScale = [1, 1, 1],
  surfaceNormal = [0, 0, 1],
}: {
  strokes: [number, number, number][][]
  strokeWidth: number
  strokeDepth: number
  cylindricalDivisions: number
  color: string
  parentScale?: [number, number, number]
  surfaceNormal?: [number, number, number]
}) {
  const parentScaleVector = new Vector3(
    Math.max(Math.abs(parentScale[0]), 1e-6),
    Math.max(Math.abs(parentScale[1]), 1e-6),
    Math.max(Math.abs(parentScale[2]), 1e-6),
  )
  const localNormalVector = new Vector3(
    surfaceNormal[0],
    surfaceNormal[1],
    surfaceNormal[2],
  ).normalize()
  const computeAxisScale = (axis: Vector3) =>
    new Vector3(
      axis.x * parentScaleVector.x,
      axis.y * parentScaleVector.y,
      axis.z * parentScaleVector.z,
    ).length()
  type StrokeMeshData = {
    key: string
    positions: Float32Array
    indices: Uint16Array
    normals: Float32Array
  }

  const strokeMeshes = useMemo<StrokeMeshData[]>(() => {
    return strokes
      .map<StrokeMeshData | null>((stroke, strokeIndex) => {
        const points = stroke
        if (points.length < 2) {
          return null
        }

        const divisions = Math.max(3, Math.round(cylindricalDivisions))
        const halfWidth = strokeWidth / 2
        const halfDepth = strokeDepth / 2
        const positions: number[] = []
        const indices: number[] = []
        const capSteps = Math.max(2, Math.min(6, Math.round(divisions / 3)))
        const tangents = points.map((point, index) => {
          const current = new Vector3(...point)
          const previous =
            index > 0 ? new Vector3(...points[index - 1]) : new Vector3(...points[index])
          const next =
            index < points.length - 1
              ? new Vector3(...points[index + 1])
              : new Vector3(...points[index])

          const tangent =
            index === 0
              ? next.clone().sub(current)
              : index === points.length - 1
                ? current.clone().sub(previous)
                : next.clone().sub(previous)

          return tangent.normalize()
        })

        const depthAxes = tangents.map((tangent) => {
          const depthAxis = localNormalVector
            .clone()
            .sub(tangent.clone().multiplyScalar(localNormalVector.dot(tangent)))
            .normalize()
          return depthAxis
        })

        const widthAxes = tangents.map((tangent, index) => {
          const widthAxis = new Vector3().crossVectors(depthAxes[index], tangent).normalize()
          return widthAxis
        })

        const rings: Array<{
          center: Vector3
          widthAxis: Vector3
          depthAxis: Vector3
          widthRadius: number
          depthRadius: number
        }> = []

        for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
          const center = new Vector3(...points[pointIndex])
          const tangent = tangents[pointIndex]
          const depthAxis = depthAxes[pointIndex]
          const widthAxis = widthAxes[pointIndex]

          if (
            tangent.lengthSq() < 1e-6 ||
            depthAxis.lengthSq() < 1e-6 ||
            widthAxis.lengthSq() < 1e-6
          ) {
            continue
          }

          const localWidthRadius = halfWidth / Math.max(computeAxisScale(widthAxis), 1e-6)
          const localDepthRadius = halfDepth / Math.max(computeAxisScale(depthAxis), 1e-6)
          rings.push({
            center,
            widthAxis,
            depthAxis,
            widthRadius: localWidthRadius,
            depthRadius: localDepthRadius,
          })
        }

        if (rings.length < 2) {
          return null
        }

        type RingSpec = {
          center: Vector3
          widthAxis: Vector3
          depthAxis: Vector3
          widthRadius: number
          depthRadius: number
        }

        const expandedRings: RingSpec[] = []
        const startTangent = tangents[0]
        const endTangent = tangents[tangents.length - 1]

        for (let step = capSteps - 1; step >= 1; step -= 1) {
          const t = step / capSteps
          const angle = t * (Math.PI / 2)
          const radiusScale = Math.cos(angle)
          const extensionScale = Math.sin(angle)
          const base = rings[0]
          expandedRings.push({
            center: base.center
              .clone()
              .add(startTangent.clone().multiplyScalar(-halfWidth * extensionScale)),
            widthAxis: base.widthAxis,
            depthAxis: base.depthAxis,
            widthRadius: base.widthRadius * radiusScale,
            depthRadius: base.depthRadius * radiusScale,
          })
        }

        expandedRings.push(...rings)

        for (let step = 1; step < capSteps; step += 1) {
          const t = step / capSteps
          const angle = t * (Math.PI / 2)
          const radiusScale = Math.cos(angle)
          const extensionScale = Math.sin(angle)
          const base = rings[rings.length - 1]
          expandedRings.push({
            center: base.center
              .clone()
              .add(endTangent.clone().multiplyScalar(halfWidth * extensionScale)),
            widthAxis: base.widthAxis,
            depthAxis: base.depthAxis,
            widthRadius: base.widthRadius * radiusScale,
            depthRadius: base.depthRadius * radiusScale,
          })
        }

        for (const ring of expandedRings) {
          for (let division = 0; division < divisions; division += 1) {
            const angle = (division / divisions) * Math.PI * 2
            const radialOffset = ring.widthAxis
              .clone()
              .multiplyScalar(Math.cos(angle) * ring.widthRadius)
              .add(ring.depthAxis.clone().multiplyScalar(Math.sin(angle) * ring.depthRadius))
            const vertex = ring.center.clone().add(radialOffset)
            positions.push(vertex.x, vertex.y, vertex.z)
          }
        }

        const startPoleIndex = positions.length / 3
        const startPole = rings[0].center.clone().add(startTangent.clone().multiplyScalar(-halfWidth))
        positions.push(startPole.x, startPole.y, startPole.z)

        const endPoleIndex = positions.length / 3
        const endPole = rings[rings.length - 1].center
          .clone()
          .add(endTangent.clone().multiplyScalar(halfWidth))
        positions.push(endPole.x, endPole.y, endPole.z)

        for (let ringIndex = 0; ringIndex < expandedRings.length - 1; ringIndex += 1) {
          for (let division = 0; division < divisions; division += 1) {
            const nextDivision = (division + 1) % divisions
            const startA = ringIndex * divisions + division
            const startB = ringIndex * divisions + nextDivision
            const endA = (ringIndex + 1) * divisions + division
            const endB = (ringIndex + 1) * divisions + nextDivision
            indices.push(startA, endA, startB)
            indices.push(startB, endA, endB)
          }
        }

        for (let division = 0; division < divisions; division += 1) {
          const nextDivision = (division + 1) % divisions
          indices.push(startPoleIndex, division, nextDivision)
        }

        const lastRingStart = (expandedRings.length - 1) * divisions
        for (let division = 0; division < divisions; division += 1) {
          const nextDivision = (division + 1) % divisions
          indices.push(
            endPoleIndex,
            lastRingStart + nextDivision,
            lastRingStart + division,
          )
        }

        const positionsArray = new Float32Array(positions)
        const indicesArray = new Uint16Array(indices)
        const geometry = new BufferGeometry()
        geometry.setAttribute('position', new BufferAttribute(positionsArray, 3))
        geometry.setIndex(new BufferAttribute(indicesArray, 1))
        geometry.computeVertexNormals()
        const normalAttribute = geometry.getAttribute('normal')
        const normalsArray = new Float32Array(normalAttribute.array)
        geometry.dispose()

        return {
          key: `stroke-${strokeIndex}`,
          positions: positionsArray,
          indices: indicesArray,
          normals: normalsArray,
        }
      })
      .filter((value): value is StrokeMeshData => value !== null)
  }, [
    cylindricalDivisions,
    localNormalVector.x,
    localNormalVector.y,
    localNormalVector.z,
    parentScaleVector.x,
    parentScaleVector.y,
    parentScaleVector.z,
    strokeDepth,
    strokeWidth,
    strokes,
  ])

  return (
    <>
      {strokeMeshes.map((strokeMesh) => (
        <mesh key={strokeMesh.key}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[strokeMesh.positions, 3]}
            />
            <bufferAttribute
              attach="attributes-normal"
              args={[strokeMesh.normals, 3]}
            />
            <bufferAttribute
              attach="index"
              args={[strokeMesh.indices, 1]}
            />
          </bufferGeometry>
          <meshStandardMaterial
            color={color}
            roughness={0.72}
            metalness={0.04}
            side={DoubleSide}
          />
        </mesh>
      ))}
    </>
  )
}

function PenObjectMeshes({
  penObject,
  parentObject,
  selected,
}: {
  penObject: PenSceneObject
  parentObject: DrawnSurfaceSceneObject | SelectedSurfaceSceneObject
  selected: boolean
}) {
  const { worldNormal, worldStrokes } = useMemo(() => {
    const parentQuaternion = new Quaternion().setFromEuler(
      new Euler(
        parentObject.rotation[0],
        parentObject.rotation[1],
        parentObject.rotation[2],
        'XYZ',
      ),
    )
    const parentMatrix = new Matrix4().compose(
      new Vector3(...parentObject.position),
      parentQuaternion,
      new Vector3(...parentObject.scale),
    )
    const normalMatrix = new Matrix3().getNormalMatrix(parentMatrix)
    const worldNormal = new Vector3(0, 0, 1).applyNormalMatrix(normalMatrix).normalize()
    const worldStrokes = penObject.pen.strokes.map((stroke) =>
      stroke.map((point) => {
        const worldPoint = new Vector3(point[0], point[1], point[2]).applyMatrix4(parentMatrix)
        return [worldPoint.x, worldPoint.y, worldPoint.z] as [number, number, number]
      }),
    )
    return {
      worldNormal: [worldNormal.x, worldNormal.y, worldNormal.z] as [number, number, number],
      worldStrokes,
    }
  }, [
    parentObject.position,
    parentObject.rotation,
    parentObject.scale,
    penObject.pen.strokes,
  ])

  return (
    <PenStrokeMeshes
      strokes={worldStrokes}
      strokeWidth={penObject.pen.strokeWidth}
      strokeDepth={penObject.pen.strokeDepth}
      cylindricalDivisions={penObject.pen.cylindricalDivisions}
      color={selected ? '#f4c46c' : '#d8a84a'}
      surfaceNormal={worldNormal}
    />
  )
}

function PenDraftOverlay({
  draft,
  surfaceNormal = [0, 0, 1],
}: {
  draft: PenDraft | null
  surfaceNormal?: [number, number, number]
}) {
  if (!draft || draft.strokes.length === 0) {
    return null
  }

  return (
    <group renderOrder={1200}>
      <PenStrokeMeshes
        strokes={draft.strokes}
        strokeWidth={0.05}
        strokeDepth={0.05}
        cylindricalDivisions={10}
        color="#f4c46c"
        surfaceNormal={surfaceNormal}
      />
    </group>
  )
}

function FloorGridMaterial({
  selected,
  mount = false,
}: {
  selected: boolean
  mount?: boolean
}) {
  const materialRef = useRef<ShaderMaterial | null>(null)
  const { camera } = useThree()

  const uniforms = useMemo(
    () => ({
      uBaseColor: {
        value: selected
          ? new Vector3(0.498, 0.839, 0.561)
          : mount
            ? new Vector3(0.74, 0.67, 0.87)
            : new Vector3(0.68, 0.78, 0.71),
      },
      uMinorColor: { value: new Vector3(0.72, 0.72, 0.72) },
      uMediumColor: { value: new Vector3(0.43, 0.43, 0.43) },
      uMajorColor: { value: new Vector3(0.12, 0.12, 0.12) },
      uCameraPosition: { value: new Vector3() },
    }),
    [mount, selected],
  )

  useEffect(() => {
    if (!materialRef.current) {
      return
    }

    const nextBaseColor = selected
      ? new Vector3(0.498, 0.839, 0.561)
      : mount
        ? new Vector3(0.74, 0.67, 0.87)
        : new Vector3(0.68, 0.78, 0.71)
    materialRef.current.uniforms.uBaseColor.value.copy(nextBaseColor)
  }, [mount, selected])

  useFrame(() => {
    materialRef.current?.uniforms.uCameraPosition.value.copy(camera.position)
  })

  return (
    <shaderMaterial
      ref={materialRef}
      uniforms={uniforms}
      vertexShader={`
        varying vec3 vWorldPosition;

        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `}
      fragmentShader={`
        uniform vec3 uBaseColor;
        uniform vec3 uMinorColor;
        uniform vec3 uMediumColor;
        uniform vec3 uMajorColor;
        uniform vec3 uCameraPosition;
        varying vec3 vWorldPosition;

        float gridMask(vec2 coord, float step, float width) {
          vec2 scaled = coord / step;
          vec2 grid = abs(fract(scaled - 0.5) - 0.5) / fwidth(scaled);
          float line = min(grid.x, grid.y);
          return 1.0 - smoothstep(width, width + 1.0, line);
        }

        void main() {
          float cameraDistance = length(uCameraPosition - vWorldPosition);
          float majorVisibility = 1.0;
          float mediumVisibility = 1.0 - smoothstep(7.0, 14.0, cameraDistance);
          float minorVisibility = 1.0 - smoothstep(3.0, 8.0, cameraDistance);

          float major = gridMask(vWorldPosition.xz, 1.0, 0.6) * majorVisibility;
          float medium = gridMask(vWorldPosition.xz, 0.5, 0.8) * mediumVisibility;
          float minor = gridMask(vWorldPosition.xz, 0.1, 1.0) * minorVisibility;

          vec3 color = uBaseColor;
          color = mix(color, uMinorColor, minor * 0.65);
          color = mix(color, uMediumColor, medium * 0.78);
          color = mix(color, uMajorColor, major * 0.95);

          gl_FragColor = vec4(color, 1.0);
        }
      `}
    />
  )
}

function PositionAxes({
  shaftLength,
  shaftThickness,
  headRadius,
  headHeight,
  headOffset,
  emissive = true,
  tool,
}: {
  shaftLength: number
  shaftThickness: number
  headRadius: number
  headHeight: number
  headOffset: number
  emissive?: boolean
  tool?: TransformToolKind
}) {
  return (
    <>
      <mesh
        position={[shaftLength / 2, 0, 0]}
        userData={tool ? { gizmoHandle: { tool, axis: 'x' satisfies GizmoAxis } } : undefined}
      >
        <boxGeometry args={[shaftLength, shaftThickness, shaftThickness]} />
        <meshStandardMaterial
          color="#ff6b6b"
          emissive={emissive ? '#3a0f0f' : '#000000'}
        />
      </mesh>
      <mesh
        position={[headOffset, 0, 0]}
        rotation={[0, 0, -Math.PI / 2]}
        userData={tool ? { gizmoHandle: { tool, axis: 'x' satisfies GizmoAxis } } : undefined}
      >
        <coneGeometry args={[headRadius, headHeight, 18]} />
        <meshStandardMaterial
          color="#ff6b6b"
          emissive={emissive ? '#3a0f0f' : '#000000'}
        />
      </mesh>

      <mesh
        position={[0, shaftLength / 2, 0]}
        userData={tool ? { gizmoHandle: { tool, axis: 'y' satisfies GizmoAxis } } : undefined}
      >
        <boxGeometry args={[shaftThickness, shaftLength, shaftThickness]} />
        <meshStandardMaterial
          color="#34d399"
          emissive={emissive ? '#0d2b21' : '#000000'}
        />
      </mesh>
      <mesh
        position={[0, headOffset, 0]}
        userData={tool ? { gizmoHandle: { tool, axis: 'y' satisfies GizmoAxis } } : undefined}
      >
        <coneGeometry args={[headRadius, headHeight, 18]} />
        <meshStandardMaterial
          color="#34d399"
          emissive={emissive ? '#0d2b21' : '#000000'}
        />
      </mesh>

      <mesh
        position={[0, 0, shaftLength / 2]}
        userData={tool ? { gizmoHandle: { tool, axis: 'z' satisfies GizmoAxis } } : undefined}
      >
        <boxGeometry args={[shaftThickness, shaftThickness, shaftLength]} />
        <meshStandardMaterial
          color="#60a5fa"
          emissive={emissive ? '#10223b' : '#000000'}
        />
      </mesh>
      <mesh
        position={[0, 0, headOffset]}
        rotation={[Math.PI / 2, 0, 0]}
        userData={tool ? { gizmoHandle: { tool, axis: 'z' satisfies GizmoAxis } } : undefined}
      >
        <coneGeometry args={[headRadius, headHeight, 18]} />
        <meshStandardMaterial
          color="#60a5fa"
          emissive={emissive ? '#10223b' : '#000000'}
        />
      </mesh>
    </>
  )
}

function TransformGizmo({
  tool,
  objects,
}: {
  tool: ToolKind
  objects: TransformableSceneObject[]
}) {
  const gizmoPosition = useMemo<[number, number, number] | null>(() => {
    if (tool === 'fake' || objects.length === 0) {
      return null
    }

    const sum = objects.reduce(
      (current, object) => {
        current.x += object.position[0]
        current.y += object.position[1]
        current.z += object.position[2]
        return current
      },
      { x: 0, y: 0, z: 0 },
    )

    return [
      sum.x / objects.length,
      sum.y / objects.length,
      sum.z / objects.length,
    ]
  }, [objects, tool])

  const gizmoRotation = useMemo<[number, number, number]>(() => {
    if (objects.length !== 1) {
      return [0, 0, 0]
    }
    return [...objects[0].rotation]
  }, [objects])

  if (!gizmoPosition) {
    return null
  }

  return (
    <group position={gizmoPosition} rotation={gizmoRotation}>
      {tool === 'position' ? (
        <PositionAxes
          shaftLength={1.5}
          shaftThickness={0.06}
          headRadius={0.13}
          headHeight={0.35}
          headOffset={1.675}
          tool="position"
        />
      ) : null}

      {tool === 'rotation' ? (
        <>
          <mesh
            rotation={[0, Math.PI / 2, 0]}
            userData={{ gizmoHandle: { tool: 'rotation', axis: 'x' satisfies GizmoAxis } }}
          >
            <torusGeometry args={[1.5, 0.04, 18, 96]} />
            <meshStandardMaterial color="#ff6b6b" emissive="#3a0f0f" />
          </mesh>
          <mesh
            rotation={[Math.PI / 2, 0, 0]}
            userData={{ gizmoHandle: { tool: 'rotation', axis: 'y' satisfies GizmoAxis } }}
          >
            <torusGeometry args={[1.5, 0.04, 18, 96]} />
            <meshStandardMaterial color="#34d399" emissive="#0d2b21" />
          </mesh>
          <mesh userData={{ gizmoHandle: { tool: 'rotation', axis: 'z' satisfies GizmoAxis } }}>
            <torusGeometry args={[1.5, 0.04, 18, 96]} />
            <meshStandardMaterial color="#60a5fa" emissive="#10223b" />
          </mesh>
        </>
      ) : null}

      {tool === 'scale' ? (
        <>
          <mesh
            position={[1.35, 0, 0]}
            userData={{ gizmoHandle: { tool: 'scale', axis: 'x' satisfies GizmoAxis } }}
          >
            <boxGeometry args={[1.1, 0.06, 0.06]} />
            <meshStandardMaterial color="#ff6b6b" emissive="#3a0f0f" />
          </mesh>
          <mesh
            position={[1.95, 0, 0]}
            userData={{ gizmoHandle: { tool: 'scale', axis: 'x' satisfies GizmoAxis } }}
          >
            <boxGeometry args={[0.22, 0.22, 0.22]} />
            <meshStandardMaterial color="#ff6b6b" emissive="#3a0f0f" />
          </mesh>

          <mesh
            position={[0, 1.35, 0]}
            userData={{ gizmoHandle: { tool: 'scale', axis: 'y' satisfies GizmoAxis } }}
          >
            <boxGeometry args={[0.06, 1.1, 0.06]} />
            <meshStandardMaterial color="#34d399" emissive="#0d2b21" />
          </mesh>
          <mesh
            position={[0, 1.95, 0]}
            userData={{ gizmoHandle: { tool: 'scale', axis: 'y' satisfies GizmoAxis } }}
          >
            <boxGeometry args={[0.22, 0.22, 0.22]} />
            <meshStandardMaterial color="#34d399" emissive="#0d2b21" />
          </mesh>

          <mesh
            position={[0, 0, 1.35]}
            userData={{ gizmoHandle: { tool: 'scale', axis: 'z' satisfies GizmoAxis } }}
          >
            <boxGeometry args={[0.06, 0.06, 1.1]} />
            <meshStandardMaterial color="#60a5fa" emissive="#10223b" />
          </mesh>
          <mesh
            position={[0, 0, 1.95]}
            userData={{ gizmoHandle: { tool: 'scale', axis: 'z' satisfies GizmoAxis } }}
          >
            <boxGeometry args={[0.22, 0.22, 0.22]} />
            <meshStandardMaterial color="#60a5fa" emissive="#10223b" />
          </mesh>
        </>
      ) : null}
    </group>
  )
}

function OrientationCube({
  cameraOrientationRef,
  onAlignCamera,
}: {
  cameraOrientationRef: React.MutableRefObject<Quaternion>
  onAlignCamera: (axis: CameraAlignAxis) => void
}) {
  const groupRef = useRef<Group | null>(null)

  const faceMaterials = useMemo(() => {
    const createLabelTexture = (
      label: string,
      fill: string,
      textColor = '#ffffff',
    ) => {
      const canvas = document.createElement('canvas')
      canvas.width = 1024
      canvas.height = 1024
      const context = canvas.getContext('2d')
      if (!context) {
        return new CanvasTexture(canvas)
      }

      context.fillStyle = fill
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.fillStyle = textColor
      context.font = '700 192px Geist Variable, sans-serif'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(label, canvas.width / 2, canvas.height / 2)

      const texture = new CanvasTexture(canvas)
      texture.generateMipmaps = false
      texture.minFilter = LinearFilter
      texture.magFilter = NearestFilter
      texture.needsUpdate = true
      return texture
    }

    return [
      ['RIGHT', '#1f4f61'],
      ['LEFT', '#5f2430'],
      ['TOP', '#1f5a34'],
      ['BOTTOM', '#69561b'],
      ['FRONT', '#49356b'],
      ['BACK', '#6a3d1b'],
    ].map(([label, fill]) => new MeshBasicMaterial({ map: createLabelTexture(label, fill) }))
  }, [])

  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.quaternion.copy(cameraOrientationRef.current).invert()
    }
  })

  return (
    <>
      <ambientLight intensity={0.9} />
      <directionalLight position={[3, 3, 3]} intensity={1} />
      <group ref={groupRef}>
        <mesh>
          <boxGeometry args={[1.34, 1.34, 1.34]} />
          <meshStandardMaterial color="#101614" />
        </mesh>

        <mesh
          position={[0.68, 0, 0]}
          rotation={[0, Math.PI / 2, 0]}
          material={faceMaterials[0]}
          onClick={() => onAlignCamera('right')}
        >
          <planeGeometry args={[1.32, 1.32]} />
        </mesh>
        <mesh
          position={[-0.68, 0, 0]}
          rotation={[0, -Math.PI / 2, 0]}
          material={faceMaterials[1]}
          onClick={() => onAlignCamera('left')}
        >
          <planeGeometry args={[1.32, 1.32]} />
        </mesh>
        <mesh
          position={[0, 0.68, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          material={faceMaterials[2]}
          onClick={() => onAlignCamera('top')}
        >
          <planeGeometry args={[1.32, 1.32]} />
        </mesh>
        <mesh
          position={[0, -0.68, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          material={faceMaterials[3]}
          onClick={() => onAlignCamera('bottom')}
        >
          <planeGeometry args={[1.32, 1.32]} />
        </mesh>
        <mesh
          position={[0, 0, 0.68]}
          material={faceMaterials[4]}
          onClick={() => onAlignCamera('front')}
        >
          <planeGeometry args={[1.32, 1.32]} />
        </mesh>
        <mesh
          position={[0, 0, -0.68]}
          rotation={[0, Math.PI, 0]}
          material={faceMaterials[5]}
          onClick={() => onAlignCamera('back')}
        >
          <planeGeometry args={[1.32, 1.32]} />
        </mesh>

        <group position={[-0.78, -0.78, -0.78]}>
          <PositionAxes
            shaftLength={1.32}
            shaftThickness={0.06}
            headRadius={0.12}
            headHeight={0.3}
            headOffset={1.47}
            emissive={false}
          />
        </group>
      </group>
    </>
  )
}

export function MemoryPalaceViewPage() {
  const { name = '' } = useParams()
  const decodedName = decodeURIComponent(name)
  const [item, setItem] = useState<MemoryPalaceRecord | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toolActive, setToolActive] = useState(false)
  const [selectedTool, setSelectedTool] = useState<ToolKind>('fake')
  const [cameraMode, setCameraMode] = useState<CameraMode>('perspective')
  const [sceneMode, setSceneMode] = useState<SceneMode>('general')
  const [debugOpen, setDebugOpen] = useState(true)
  const [debugLogs, setDebugLogs] = useState<string[]>([])
  const debugContainerRef = useRef<HTMLDivElement | null>(null)
  const debugStickToBottomRef = useRef(true)
  const [objects, setObjects] = useState<SceneObject[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [propertiesTab, setPropertiesTab] = useState<'general' | 'mesh' | 'floor' | 'pen'>(
    'general',
  )
  const cameraOrientationRef = useRef(new Quaternion())
  const cameraTargetRef = useRef(new Vector3(0, 0, 0))
  const [cameraAlignRequest, setCameraAlignRequest] = useState<{
    axis: CameraAlignAxis
    nonce: number
  } | null>(null)
  const [drawnSurfaceDraft, setDrawnSurfaceDraft] = useState<DrawnSurfaceDraft | null>(null)
  const [selectedSurfaceFaces, setSelectedSurfaceFaces] = useState<SelectedSurfaceFace[]>([])
  const [selectedSurfaceOrientationFace, setSelectedSurfaceOrientationFace] =
    useState<SelectedSurfaceFace | null>(null)
  const [selectedSurfacePositionFaces, setSelectedSurfacePositionFaces] = useState<
    SelectedSurfaceFace[]
  >([])
  const [penProjectionSurfaceId, setPenProjectionSurfaceId] = useState<string | null>(null)
  const [penDraft, setPenDraft] = useState<PenDraft | null>(null)
  const breadcrumbs = useMemo(() => [{ label: `View ${decodedName}` }], [decodedName])
  usePageBreadcrumbs(breadcrumbs)
  const selectedObject =
    selectedIds.size === 1
      ? objects.find((object) => selectedIds.has(object.id)) ?? null
      : null
  const transformSelectedObjects = useMemo(
    () =>
      objects.filter(
        (object): object is TransformableSceneObject =>
          selectedIds.has(object.id) && isTransformableObject(object),
      ),
    [objects, selectedIds],
  )
  const canUseTransformTools =
    selectedIds.size === 0 ||
    [...selectedIds].every((id) => {
      const object = objects.find((entry) => entry.id === id)
      return object ? isTransformableObject(object) : false
    })
  const selectedProjectionSurface =
    selectedIds.size === 1
      ? objects.find((object) => selectedIds.has(object.id)) ?? null
      : null
  const penAddEnabled = sceneMode === 'general' && isProjectionSurfaceObject(selectedProjectionSurface)
  const hasFloor = objects.some((object) => object.primitiveType === 'floor')
  const sceneListEntries = useMemo(() => {
    const topLevel = objects.filter((object) => object.primitiveType !== 'pen')
    const penChildren = objects.filter(
      (object): object is PenSceneObject => object.primitiveType === 'pen',
    )
    return topLevel.flatMap((object) => [
      { object, depth: 0 },
      ...penChildren
        .filter((penObject) => penObject.parentId === object.id)
        .map((penObject) => ({ object: penObject as SceneObject, depth: 1 })),
    ])
  }, [objects])
  const penDraftSurfaceNormal = useMemo<[number, number, number]>(() => {
    if (!penProjectionSurfaceId) {
      return [0, 0, 1]
    }
    const parentObject = objects.find((object) => object.id === penProjectionSurfaceId)
    if (!parentObject || !isProjectionSurfaceObject(parentObject)) {
      return [0, 0, 1]
    }
    const parentQuaternion = new Quaternion().setFromEuler(
      new Euler(
        parentObject.rotation[0],
        parentObject.rotation[1],
        parentObject.rotation[2],
        'XYZ',
      ),
    )
    const parentMatrix = new Matrix4().compose(
      new Vector3(...parentObject.position),
      parentQuaternion,
      new Vector3(...parentObject.scale),
    )
    const normalMatrix = new Matrix3().getNormalMatrix(parentMatrix)
    const worldNormal = new Vector3(0, 0, 1).applyNormalMatrix(normalMatrix).normalize()
    return [worldNormal.x, worldNormal.y, worldNormal.z]
  }, [objects, penProjectionSurfaceId])

  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [addSubmenu, setAddSubmenu] = useState<'primitives' | 'import' | null>(null)
  const { refs, floatingStyles, context } = useFloating({
    open: addMenuOpen,
    onOpenChange: setAddMenuOpen,
    placement: 'right-start',
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip(), shift({ padding: 8 })],
  })
  const click = useClick(context)
  const dismiss = useDismiss(context)
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss])
  const importFileInputRef = useRef<HTMLInputElement | null>(null)
  const pendingImportFormatRef = useRef<ImportFormat | null>(null)

  useEffect(() => {
    if (!addMenuOpen) {
      setAddSubmenu(null)
    }
  }, [addMenuOpen])

  const [sceneContextMenu, setSceneContextMenu] = useState<{
    objectId: string
    x: number
    y: number
  } | null>(null)
  const {
    refs: sceneContextMenuRefs,
    floatingStyles: sceneContextMenuStyles,
    context: sceneContextMenuContext,
  } = useFloating({
    open: sceneContextMenu !== null,
    onOpenChange: (open) => {
      if (!open) {
        setSceneContextMenu(null)
      }
    },
    placement: 'right-start',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [offset(4), flip(), shift({ padding: 8 })],
  })
  const dismissSceneContextMenu = useDismiss(sceneContextMenuContext)
  const { getFloatingProps: getSceneContextMenuFloatingProps } = useInteractions([
    dismissSceneContextMenu,
  ])

  const [floorGridEditor, setFloorGridEditor] = useState<{
    objectId: string
    x: number
    y: number
  } | null>(null)
  const [floorGridTool, setFloorGridTool] = useState<'eraser' | 'mount' | 'flat'>('flat')
  const floorGridPaintingRef = useRef(false)
  const {
    refs: floorGridRefs,
    floatingStyles: floorGridStyles,
    context: floorGridContext,
  } = useFloating({
    open: floorGridEditor !== null,
    onOpenChange: (open) => {
      if (!open) {
        setFloorGridEditor(null)
      }
    },
    placement: 'right-start',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [offset(4), flip(), shift({ padding: 8 })],
  })
  const dismissFloorGrid = useDismiss(floorGridContext)
  const { getFloatingProps: getFloorGridFloatingProps } = useInteractions([
    dismissFloorGrid,
  ])
  const floorGridObject =
    floorGridEditor !== null
      ? objects.find(
          (object): object is FloorSceneObject =>
            object.primitiveType === 'floor' && object.id === floorGridEditor.objectId,
        ) ?? null
      : null

  useEffect(() => {
    if (!floorGridEditor) {
      return
    }

    floorGridRefs.setPositionReference({
      getBoundingClientRect: () =>
        DOMRect.fromRect({
          x: floorGridEditor.x,
          y: floorGridEditor.y,
          width: 0,
          height: 0,
        }),
    })
  }, [floorGridEditor, floorGridRefs])

  useEffect(() => {
    const stopPainting = () => {
      floorGridPaintingRef.current = false
    }
    window.addEventListener('pointerup', stopPainting)
    window.addEventListener('pointercancel', stopPainting)
    return () => {
      window.removeEventListener('pointerup', stopPainting)
      window.removeEventListener('pointercancel', stopPainting)
    }
  }, [])

  const appendDebugLog = useCallback((message: string) => {
    setDebugLogs((current) => {
      const timestamp = new Date().toLocaleTimeString()
      const next = [...current, `${timestamp} ${message}`]
      return next.slice(-MAX_DEBUG_LOGS)
    })
  }, [])

  const toolHandlers = useMemo<ToolHandlers>(
    () => ({
      start: (tool, state, message) => {
        if (tool === 'fake') {
          return state
        }
        appendDebugLog(`[${tool}] ${message}`)
        if (sceneMode === 'drawn-surface' && tool === 'drawn-surface' && state.worldPoint) {
          const point = state.worldPoint
          const cameraForward = new Vector3(0, 0, -1).applyQuaternion(cameraOrientationRef.current)
          const cameraUp = new Vector3(0, 1, 0)
            .applyQuaternion(cameraOrientationRef.current)
            .normalize()
          const cameraRight = new Vector3().crossVectors(cameraForward, cameraUp).normalize()
          setDrawnSurfaceDraft({
            worldPoints: [point],
            center: point,
            rotation: [0, 0, 0],
            planeRight: [cameraRight.x, cameraRight.y, cameraRight.z],
            planeUp: [cameraUp.x, cameraUp.y, cameraUp.z],
          })
        }
        if (sceneMode === 'pen' && tool === 'pen' && state.worldPoint && penProjectionSurfaceId) {
          setPenDraft((current) => {
            if (!current || current.surfaceId !== penProjectionSurfaceId) {
              return current
            }
            return {
              ...current,
              strokes: [...current.strokes, [state.worldPoint!]],
            }
          })
        }
        return state
      },
      update: (tool, state, message) => {
        if (tool === 'fake') {
          return state
        }
        appendDebugLog(`[${tool}] ${message}`)
        if (sceneMode === 'drawn-surface' && tool === 'drawn-surface' && state.worldPoint) {
          setDrawnSurfaceDraft((current) => {
            if (!current) {
              return {
                worldPoints: [state.worldPoint!],
                center: state.worldPoint!,
                rotation: [0, 0, 0],
                planeRight: [1, 0, 0],
                planeUp: [0, 1, 0],
              }
            }
            const lastPoint = current.worldPoints[current.worldPoints.length - 1]
            const nextPoint = state.worldPoint!
            const dx = nextPoint[0] - lastPoint[0]
            const dy = nextPoint[1] - lastPoint[1]
            const dz = nextPoint[2] - lastPoint[2]
            if (Math.hypot(dx, dy, dz) < 0.02) {
              return current
            }
            return {
              ...current,
              worldPoints: [...current.worldPoints, nextPoint],
            }
          })
        }
        if (sceneMode === 'pen' && tool === 'pen' && state.worldPoint) {
          setPenDraft((current) => {
            if (!current || current.surfaceId !== penProjectionSurfaceId) {
              return current
            }
            const nextStrokes = [...current.strokes]
            const lastStroke = nextStrokes[nextStrokes.length - 1]
            if (!lastStroke) {
              return current
            }
            const lastPoint = lastStroke[lastStroke.length - 1]
            const nextPoint = state.worldPoint!
            if (lastPoint) {
              const dx = nextPoint[0] - lastPoint[0]
              const dy = nextPoint[1] - lastPoint[1]
              const dz = nextPoint[2] - lastPoint[2]
              if (Math.hypot(dx, dy, dz) < 0.02) {
                return current
              }
            }
            nextStrokes[nextStrokes.length - 1] = [...lastStroke, nextPoint]
            return { ...current, strokes: nextStrokes }
          })
        }
        return state
      },
      end: (tool, state, message) => {
        if (tool === 'fake') {
          return
        }
        appendDebugLog(`[${tool}] ${message} (${state.updateCount} updates)`)
      },
      cancel: (tool, state, message) => {
        if (tool === 'fake') {
          return
        }
        appendDebugLog(`[${tool}] ${message} (${state.updateCount} updates)`)
      },
    }),
    [appendDebugLog, penProjectionSurfaceId, sceneMode],
  )

  const toolOptions: Array<{
    id: ToolKind
    label: string
    icon: typeof Circle
  }> = sceneMode === 'drawn-surface'
    ? [
        { id: 'fake', label: 'Fake', icon: Circle },
        { id: 'drawn-surface', label: 'Drawn Surface', icon: Move },
      ]
    : sceneMode === 'selected-surface'
      ? [
          { id: 'fake', label: 'Fake', icon: Circle },
          { id: 'selected-surface', label: 'Selected Surface', icon: Shapes },
          {
            id: 'selected-surface-orientation',
            label: 'Face Orientation',
            icon: Compass,
          },
          {
            id: 'selected-surface-position',
            label: 'Face Position',
            icon: Crosshair,
          },
        ]
      : sceneMode === 'pen'
        ? [
            { id: 'fake', label: 'Fake', icon: Circle },
            { id: 'pen', label: 'Pen', icon: Pencil },
          ]
        : canUseTransformTools
          ? [
              { id: 'fake', label: 'Fake', icon: Circle },
              { id: 'position', label: 'Position', icon: Move },
              { id: 'rotation', label: 'Rotation', icon: RotateCw },
              { id: 'scale', label: 'Scale', icon: Expand },
            ]
          : [{ id: 'fake', label: 'Fake', icon: Circle }]

  const enterDrawnSurfaceMode = () => {
    setSceneMode('drawn-surface')
    setCameraMode('orthographic')
    setSelectedTool('drawn-surface')
    setSelectedIds(new Set())
    setDrawnSurfaceDraft(null)
    setSelectedSurfaceFaces([])
    setSelectedSurfaceOrientationFace(null)
    setSelectedSurfacePositionFaces([])
    setPropertiesTab('general')
    setAddMenuOpen(false)
  }

  const enterSelectedSurfaceMode = () => {
    setSceneMode('selected-surface')
    setSelectedTool('selected-surface')
    setSelectedIds(new Set())
    setDrawnSurfaceDraft(null)
    setSelectedSurfaceFaces([])
    setSelectedSurfaceOrientationFace(null)
    setSelectedSurfacePositionFaces([])
    setAddMenuOpen(false)
  }

  const enterPenMode = () => {
    if (!isProjectionSurfaceObject(selectedProjectionSurface)) {
      return
    }
    setSceneMode('pen')
    setSelectedTool('pen')
    setPenProjectionSurfaceId(selectedProjectionSurface.id)
    setPenDraft({
      surfaceId: selectedProjectionSurface.id,
      strokes: [],
    })
    setAddMenuOpen(false)
  }

  useEffect(() => {
    const element = debugContainerRef.current
    if (!element || !debugOpen || !debugStickToBottomRef.current) {
      return
    }
    element.scrollTop = element.scrollHeight
  }, [debugLogs, debugOpen])

  useEffect(() => {
    let isActive = true
    getMemoryPalace(decodedName)
      .then((result) => {
        if (isActive) {
          setItem(result)
        }
      })
      .catch((loadError) => {
        if (isActive) {
          setError(loadError instanceof Error ? loadError.message : 'Load failed.')
        }
      })
    return () => {
      isActive = false
    }
  }, [decodedName])

  const addPrimitive = (kind: MeshPrimitiveKind) => {
    const nextNumber =
      objects.filter(
        (object) => object.objectType === 'Mesh' && object.primitiveType === kind,
      ).length + 1
    const column = (objects.length % 4) - 1.5
    const row = Math.floor(objects.length / 4)
    const nextId = createSceneObjectId(new Set(objects.map((object) => object.id)))
    const nextObject: SceneObject = {
      id: nextId,
      objectType: 'Mesh',
      primitiveType: kind,
      name: `${MESH_PRIMITIVE_LABELS[kind]} ${nextNumber}`,
      position: [column * 1.8, 0, -row * 1.8],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      mesh: {
        color: '#4caf6a',
      },
    }
    setObjects((current) => [...current, nextObject])
    setPropertiesTab('general')
    setAddMenuOpen(false)
  }

  const startImport = (format: ImportFormat) => {
    const input = importFileInputRef.current
    if (!input) {
      return
    }
    pendingImportFormatRef.current = format
    input.accept = IMPORT_FORMAT_DETAILS[format].accept
    input.click()
    setAddMenuOpen(false)
  }

  const finishImport = (format: ImportFormat, fileName: string, model: Object3D) => {
    const details = IMPORT_FORMAT_DETAILS[format]
    const container = normalizeImportedModel(model)
    const nextNumber =
      objects.filter(
        (object) =>
          object.primitiveType === 'imported-model' &&
          object.importedModel.format === format,
      ).length + 1
    const nextId = createSceneObjectId(new Set(objects.map((object) => object.id)))
    const nextObject: ImportedModelSceneObject = {
      id: nextId,
      objectType: details.objectType,
      primitiveType: 'imported-model',
      name: `${details.objectType} ${nextNumber}`,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      importedModel: {
        format,
        fileName,
        object3d: container,
      },
    }
    setObjects((current) => [...current, nextObject])
    setSelectedIds(new Set([nextId]))
    setPropertiesTab('general')
    appendDebugLog(`[import] ${fileName} added as ${nextObject.name}`)
  }

  const handleImportFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const format = pendingImportFormatRef.current
    const input = event.target
    const file = input.files?.[0] ?? null
    input.value = ''
    pendingImportFormatRef.current = null
    if (!format || !file) {
      return
    }
    try {
      const buffer = await file.arrayBuffer()
      if (format === 'stl') {
        const geometry = new STLLoader().parse(buffer)
        if (!geometry.getAttribute('normal')) {
          geometry.computeVertexNormals()
        }
        finishImport(
          format,
          file.name,
          new Mesh(
            geometry,
            new MeshStandardMaterial({
              color: '#b8c4cc',
              roughness: 0.78,
              metalness: 0.12,
            }),
          ),
        )
      } else if (format === 'glb') {
        const gltf = await new GLTFLoader().parseAsync(buffer, '')
        finishImport(format, file.name, gltf.scene)
      } else {
        finishImport(format, file.name, new FBXLoader().parse(buffer, ''))
      }
    } catch (importError) {
      appendDebugLog(
        `[import] ${format} import of ${file.name} failed: ${
          importError instanceof Error ? importError.message : 'unknown error'
        }`,
      )
    }
  }

  const addFloor = () => {
    if (hasFloor) {
      return
    }
    const nextId = createSceneObjectId(new Set(objects.map((object) => object.id)))
    const nextObject: SceneObject = {
      id: nextId,
      objectType: 'Floor',
      primitiveType: 'floor',
      name: 'Floor',
      floor: {
        height: 0.2,
        cells: createDefaultFloorCells(),
        mountDirection: 'right',
      },
    }
    setObjects((current) => [...current, nextObject])
    setPropertiesTab('general')
    setAddMenuOpen(false)
  }

  const toggleSelectedSurfaceFace = useCallback(
    (
      tool: 'selected-surface' | 'selected-surface-orientation' | 'selected-surface-position',
      face: SelectedSurfaceFace,
    ) => {
      if (tool === 'selected-surface') {
        setSelectedSurfaceFaces((current) => {
          const existingIndex = current.findIndex((entry) => entry.key === face.key)
          if (existingIndex >= 0) {
            setSelectedSurfaceOrientationFace((orientationFace) =>
              orientationFace?.key === face.key ? null : orientationFace,
            )
            setSelectedSurfacePositionFaces((positionFaces) =>
              positionFaces.filter((entry) => entry.key !== face.key),
            )
            return current.filter((entry) => entry.key !== face.key)
          }
          if (!canAppendSelectedSurfaceFace(current, face)) {
            appendDebugLog(
              '[selected-surface] face rejected (must share an edge with the current selection)',
            )
            return current
          }
          appendDebugLog(`[selected-surface] face selected ${face.objectId}`)
          return [...current, face]
        })
        return
      }

      const existsInSelection = selectedSurfaceFaces.some((entry) => entry.key === face.key)
      if (!existsInSelection) {
        appendDebugLog('[selected-surface] face must already be in the selected surface set')
        return
      }

      if (tool === 'selected-surface-orientation') {
        setSelectedSurfaceOrientationFace((current) =>
          current?.key === face.key ? null : face,
        )
        appendDebugLog('[selected-surface] orientation face updated')
        return
      }

      setSelectedSurfacePositionFaces((current) => {
        const hasFace = current.some((entry) => entry.key === face.key)
        const next = hasFace
          ? current.filter((entry) => entry.key !== face.key)
          : [...current, face]
        appendDebugLog(
          hasFace
            ? '[selected-surface] position face removed'
            : '[selected-surface] position face added',
        )
        return next
      })
    },
    [appendDebugLog, selectedSurfaceFaces],
  )

  const completeDrawnSurface = useCallback(() => {
    if (!drawnSurfaceDraft || drawnSurfaceDraft.worldPoints.length < 3) {
      setSceneMode('general')
      setSelectedTool('fake')
      setDrawnSurfaceDraft(null)
      return
    }

    const centerVector = drawnSurfaceDraft.worldPoints.reduce(
      (current, point) => {
        current.x += point[0]
        current.y += point[1]
        current.z += point[2]
        return current
      },
      { x: 0, y: 0, z: 0 },
    )
    const center: [number, number, number] = [
      centerVector.x / drawnSurfaceDraft.worldPoints.length,
      centerVector.y / drawnSurfaceDraft.worldPoints.length,
      centerVector.z / drawnSurfaceDraft.worldPoints.length,
    ]

    const cameraRight = new Vector3(...drawnSurfaceDraft.planeRight).normalize()
    const planeUp = new Vector3(...drawnSurfaceDraft.planeUp).normalize()
    const cameraForward = new Vector3().crossVectors(cameraRight, planeUp).normalize()
    const rotationMatrix = new Matrix4().makeBasis(
      cameraForward.clone().multiplyScalar(-1),
      planeUp,
      cameraRight,
    )
    const rotationQuaternion = new Quaternion().setFromRotationMatrix(rotationMatrix)
    const rotationEuler = new Euler().setFromQuaternion(rotationQuaternion, 'XYZ')
    const centerWorld = new Vector3(...center)

    const linePoints = smoothLinePoints(
      drawnSurfaceDraft.worldPoints.map((point) => {
        const offset = new Vector3(point[0], point[1], point[2]).sub(centerWorld)
        return [offset.dot(cameraRight), offset.dot(planeUp)] as [number, number]
      }),
    )

    const nextId = createSceneObjectId(new Set(objects.map((object) => object.id)))
    const nextObject: DrawnSurfaceSceneObject = {
      id: nextId,
      objectType: 'Drawn Surface',
      primitiveType: 'drawn-surface',
      name: `Drawn Surface ${objects.filter((object) => object.primitiveType === 'drawn-surface').length + 1}`,
      position: center,
      rotation: [rotationEuler.x, rotationEuler.y, rotationEuler.z],
      scale: [5, 1, 1],
      drawnSurface: {
        linePoints,
        depth: 1,
      },
    }
    setObjects((current) => [...current, nextObject])
    setSelectedIds(new Set([nextObject.id]))
    setSceneMode('general')
    setSelectedTool('fake')
    setDrawnSurfaceDraft(null)
  }, [cameraOrientationRef, drawnSurfaceDraft, objects])

  const cancelDrawnSurface = useCallback(() => {
    setSceneMode('general')
    setSelectedTool('fake')
    setDrawnSurfaceDraft(null)
  }, [])

  const completeSelectedSurface = useCallback(() => {
    if (selectedSurfaceFaces.length === 0 || !selectedSurfaceOrientationFace) {
      return
    }

    const orientationVertices = selectedSurfaceOrientationFace.worldVertices.map(
      (vertex) => new Vector3(vertex[0], vertex[1], vertex[2]),
    ) as [Vector3, Vector3, Vector3]
    const normalVector = new Vector3(
      selectedSurfaceOrientationFace.normal[0],
      selectedSurfaceOrientationFace.normal[1],
      selectedSurfaceOrientationFace.normal[2],
    ).normalize()
    const xAxis = orientationVertices[1]
      .clone()
      .sub(orientationVertices[0])
      .projectOnPlane(normalVector)
      .normalize()
    if (xAxis.lengthSq() < 1e-6) {
      xAxis.set(1, 0, 0).projectOnPlane(normalVector).normalize()
    }
    const yAxis = new Vector3().crossVectors(normalVector, xAxis).normalize()
    const rotationMatrix = new Matrix4().makeBasis(xAxis, yAxis, normalVector)
    const rotationQuaternion = new Quaternion().setFromRotationMatrix(rotationMatrix)
    const inverseRotation = rotationQuaternion.clone().invert()
    const rotationEuler = new Euler().setFromQuaternion(rotationQuaternion, 'XYZ')

    const originFaces =
      selectedSurfacePositionFaces.length > 0
        ? selectedSurfacePositionFaces
        : selectedSurfaceFaces
    const uniqueVertexMap = new Map<string, number>()
    const vertices: [number, number, number][] = []
    const indices: number[] = []
    const centerAccumulator = new Vector3()

    for (const face of originFaces) {
      for (const vertex of face.worldVertices) {
        centerAccumulator.add(new Vector3(vertex[0], vertex[1], vertex[2]))
      }
    }

    const center = centerAccumulator.multiplyScalar(1 / (originFaces.length * 3))

    for (const face of selectedSurfaceFaces) {
      for (const vertex of face.worldVertices) {
        const key = createVertexKey(vertex)
        let vertexIndex = uniqueVertexMap.get(key)
        if (vertexIndex === undefined) {
          vertexIndex = vertices.length
          uniqueVertexMap.set(key, vertexIndex)
          const localVertex = new Vector3(
            vertex[0] - center.x,
            vertex[1] - center.y,
            vertex[2] - center.z,
          ).applyQuaternion(inverseRotation)
          vertices.push([localVertex.x, localVertex.y, localVertex.z])
        }
        indices.push(vertexIndex)
      }
    }

    const nextId = createSceneObjectId(new Set(objects.map((object) => object.id)))
    const nextObject: SelectedSurfaceSceneObject = {
      id: nextId,
      objectType: 'Selected Surface',
      primitiveType: 'selected-surface',
      name: `Selected Surface ${objects.filter((object) => object.primitiveType === 'selected-surface').length + 1}`,
      position: [center.x, center.y, center.z],
      rotation: [rotationEuler.x, rotationEuler.y, rotationEuler.z],
      scale: [1, 1, 1],
      selectedSurface: {
        vertices,
        indices,
      },
    }

    setObjects((current) => [...current, nextObject])
    setSelectedIds(new Set([nextObject.id]))
    setPropertiesTab('general')
    setSceneMode('general')
    setSelectedTool('fake')
    setSelectedSurfaceFaces([])
    setSelectedSurfaceOrientationFace(null)
    setSelectedSurfacePositionFaces([])
    appendDebugLog(`[selected-surface] created ${nextObject.name}`)
  }, [
    appendDebugLog,
    objects,
    selectedSurfaceFaces,
    selectedSurfaceOrientationFace,
    selectedSurfacePositionFaces,
  ])

  const cancelSelectedSurface = useCallback(() => {
    setSceneMode('general')
    setSelectedTool('fake')
    setSelectedSurfaceFaces([])
    setSelectedSurfaceOrientationFace(null)
    setSelectedSurfacePositionFaces([])
  }, [])

  const completePen = useCallback(() => {
    if (!penDraft || penDraft.strokes.length === 0) {
      return
    }
    const parentSurface = objects.find((object) => object.id === penDraft.surfaceId)
    if (!parentSurface || !isProjectionSurfaceObject(parentSurface)) {
      return
    }
    const parentMatrix = new Matrix4()
      .compose(
        new Vector3(...parentSurface.position),
        new Quaternion().setFromEuler(
          new Euler(
            parentSurface.rotation[0],
            parentSurface.rotation[1],
            parentSurface.rotation[2],
            'XYZ',
          ),
        ),
        new Vector3(...parentSurface.scale),
      )
      .invert()

    const validStrokes = penDraft.strokes.filter((stroke) => stroke.length >= 2)
    if (validStrokes.length === 0) {
      return
    }

    const nextObjects: PenSceneObject[] = validStrokes.map((stroke, index) => {
      const nextId = createSceneObjectId(new Set(objects.map((object) => object.id)))
      const localStroke = stroke.map((point) => {
        const localPoint = new Vector3(point[0], point[1], point[2]).applyMatrix4(parentMatrix)
        return [localPoint.x, localPoint.y, localPoint.z] as [number, number, number]
      })
      return {
        id: nextId,
        parentId: parentSurface.id,
        objectType: 'Pen',
        primitiveType: 'pen',
        name: `Pen ${objects.filter((object) => object.primitiveType === 'pen').length + index + 1}`,
        pen: {
          strokes: [localStroke],
          strokeWidth: 0.05,
          strokeDepth: 0.05,
          cylindricalDivisions: 10,
        },
      }
    })

    setObjects((current) => [...current, ...nextObjects])
    setSceneMode('general')
    setSelectedTool('fake')
    setPenDraft(null)
    setPenProjectionSurfaceId(null)
    setSelectedIds(new Set(nextObjects.map((object) => object.id)))
  }, [objects, penDraft])

  const cancelPen = useCallback(() => {
    setSceneMode('general')
    setSelectedTool('fake')
    setPenDraft(null)
    setPenProjectionSurfaceId(null)
  }, [])

  const toggleSelection = (id: string) => {
    setSelectedIds((current) => {
      const targetObject = objects.find((object) => object.id === id)
      if (!targetObject) {
        return current
      }

      if (
        (selectedTool === 'position' ||
          selectedTool === 'rotation' ||
          selectedTool === 'scale') &&
        !isTransformableObject(targetObject)
      ) {
        setSelectedTool('fake')
        return new Set([id])
      }

      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const updateObject = useCallback(
    (
      id: string,
      updater: (object: SceneObject) => SceneObject,
    ) => {
      setObjects((current) =>
        current.map((object) => (object.id === id ? updater(object) : object)),
      )
    },
    [],
  )

  const updateSelectedObjectName = (value: string) => {
    if (!selectedObject) {
      return
    }
    updateObject(selectedObject.id, (object) => ({
      ...object,
      name: value,
    }))
  }

  const updateSelectedTransformTupleValue = (
    key: 'position' | 'rotation' | 'scale',
    index: 0 | 1 | 2,
    value: string,
  ) => {
    if (!selectedObject || !isTransformableObject(selectedObject)) {
      return
    }

    const parsedValue = Number(value)
    updateObject(selectedObject.id, (object) => {
      if (!isTransformableObject(object)) {
        return object
      }
      const nextTuple = [...object[key]] as [number, number, number]
      nextTuple[index] = Number.isFinite(parsedValue)
        ? key === 'rotation'
          ? degreesToRadians(parsedValue)
          : parsedValue
        : 0
      return {
        ...object,
        [key]: nextTuple,
      }
    })
  }

  const updateSelectedObjectMeshColor = (value: string) => {
    if (!selectedObject || selectedObject.objectType !== 'Mesh') {
      return
    }
    updateObject(selectedObject.id, (object) => {
      if (object.objectType !== 'Mesh') {
        return object
      }
      return {
        ...object,
        mesh: {
          ...object.mesh,
          color: value,
        },
      }
    })
  }

  const updateSelectedFloorHeight = (value: string) => {
    if (!selectedObject || selectedObject.primitiveType !== 'floor') {
      return
    }
    const parsedValue = Number(value)
    updateObject(selectedObject.id, (object) => {
      if (object.primitiveType !== 'floor') {
        return object
      }
      return {
        ...object,
        floor: {
          ...object.floor,
          height: Number.isFinite(parsedValue) ? Math.max(0.05, parsedValue) : 0.2,
        },
      }
    })
  }

  const updateSelectedPenValue = (
    key: 'strokeWidth' | 'strokeDepth' | 'cylindricalDivisions',
    value: string,
  ) => {
    if (!selectedObject || selectedObject.primitiveType !== 'pen') {
      return
    }
    const parsedValue = Number(value)
    updateObject(selectedObject.id, (object) => {
      if (object.primitiveType !== 'pen') {
        return object
      }
      return {
        ...object,
        pen: {
          ...object.pen,
          [key]:
            key === 'strokeWidth' || key === 'strokeDepth'
              ? Number.isFinite(parsedValue)
                ? Math.max(0.001, parsedValue)
                : object.pen[key]
              : key === 'cylindricalDivisions'
                ? Number.isFinite(parsedValue)
                  ? Math.max(3, Math.round(parsedValue))
                  : object.pen.cylindricalDivisions
              : object.pen.cylindricalDivisions,
        },
      }
    })
  }

  const availablePropertyTabs: Array<'general' | 'mesh' | 'floor' | 'pen'> = ['general']
  if (selectedObject?.objectType === 'Mesh') {
    availablePropertyTabs.push('mesh')
  }
  if (selectedObject?.primitiveType === 'floor') {
    availablePropertyTabs.push('floor')
  }
  if (selectedObject?.primitiveType === 'pen') {
    availablePropertyTabs.push('pen')
  }

  const applyTransformSelection = useCallback(
    (dragState: GizmoDragState, currentWorldPoint: [number, number, number]) => {
      const axisIndex = dragState.axis === 'x' ? 0 : dragState.axis === 'y' ? 1 : 2
      const centerVector = new Vector3(...dragState.center)
      const startVector = new Vector3(...dragState.startWorldPoint)
      const currentVector = new Vector3(...currentWorldPoint)
      const axisDirection = new Vector3(
        dragState.axis === 'x' ? 1 : 0,
        dragState.axis === 'y' ? 1 : 0,
        dragState.axis === 'z' ? 1 : 0,
      ).applyQuaternion(
        new Quaternion(
          dragState.orientation[0],
          dragState.orientation[1],
          dragState.orientation[2],
          dragState.orientation[3],
        ),
      )
      const worldDelta = currentVector.clone().sub(startVector)

      setObjects((current) =>
        current.map((object) => {
          const snapshot = dragState.initialSelection.find((entry) => entry.id === object.id)
          if (!snapshot || !isTransformableObject(object)) {
            return object
          }

          if (dragState.tool === 'position') {
            const delta = worldDelta.dot(axisDirection)
            const nextPosition = [...snapshot.position] as [number, number, number]
            nextPosition[0] = snapshot.position[0] + axisDirection.x * delta
            nextPosition[1] = snapshot.position[1] + axisDirection.y * delta
            nextPosition[2] = snapshot.position[2] + axisDirection.z * delta
            return {
              ...object,
              position: nextPosition,
            }
          }

          if (dragState.tool === 'scale') {
            const delta = worldDelta.dot(axisDirection)
            const nextScale = [...snapshot.scale] as [number, number, number]
            nextScale[axisIndex] = Math.max(0.1, snapshot.scale[axisIndex] + delta)
            return {
              ...object,
              scale: nextScale,
            }
          }

          const startDirection = startVector.clone().sub(centerVector).normalize()
          const currentDirection = currentVector.clone().sub(centerVector).normalize()
          if (startDirection.lengthSq() < 1e-6 || currentDirection.lengthSq() < 1e-6) {
            return object
          }

          const cross = startDirection.clone().cross(currentDirection)
          const angle = Math.atan2(cross.dot(axisDirection), startDirection.dot(currentDirection))
          const hasLocalOrientation =
            dragState.initialSelection.length === 1 &&
            (Math.abs(dragState.orientation[0]) > 1e-6 ||
              Math.abs(dragState.orientation[1]) > 1e-6 ||
              Math.abs(dragState.orientation[2]) > 1e-6 ||
              Math.abs(dragState.orientation[3] - 1) > 1e-6)

          let nextRotation: [number, number, number]
          if (hasLocalOrientation) {
            const baseQuaternion = new Quaternion().setFromEuler(
              new Euler(snapshot.rotation[0], snapshot.rotation[1], snapshot.rotation[2], 'XYZ'),
            )
            const localAxis =
              dragState.axis === 'x'
                ? new Vector3(1, 0, 0)
                : dragState.axis === 'y'
                  ? new Vector3(0, 1, 0)
                  : new Vector3(0, 0, 1)
            const deltaQuaternion = new Quaternion().setFromAxisAngle(localAxis, angle)
            const nextEuler = new Euler().setFromQuaternion(
              baseQuaternion.multiply(deltaQuaternion),
              'XYZ',
            )
            nextRotation = [nextEuler.x, nextEuler.y, nextEuler.z]
          } else {
            nextRotation = [...snapshot.rotation] as [number, number, number]
            nextRotation[axisIndex] = snapshot.rotation[axisIndex] + angle
          }
          return {
            ...object,
            rotation: nextRotation,
          }
        }),
      )
    },
    [],
  )

  const closeSceneContextMenu = () => {
    setSceneContextMenu(null)
  }

  const openSceneContextMenu = (
    event: MouseEvent<HTMLButtonElement>,
    objectId: string,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    const targetObject = objects.find((object) => object.id === objectId)
    if (!targetObject) {
      return
    }
    if (selectedTool !== 'fake' && !isTransformableObject(targetObject)) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set([objectId]))
    }
    setPropertiesTab('general')
    setSceneContextMenu({
      objectId,
      x: event.clientX,
      y: event.clientY,
    })
  }

  const paintFloorGridCell = (row: number, column: number) => {
    if (!floorGridEditor) {
      return
    }
    const nextState: FloorCellState =
      floorGridTool === 'eraser' ? 'empty' : floorGridTool === 'mount' ? 'mount' : 'flat'
    updateObject(floorGridEditor.objectId, (object) => {
      if (object.primitiveType !== 'floor') {
        return object
      }
      if (object.floor.cells[row]?.[column] === nextState) {
        return object
      }
      return {
        ...object,
        floor: {
          ...object.floor,
          cells: object.floor.cells.map((cellRow, rowIndex) =>
            rowIndex === row
              ? cellRow.map((cell, columnIndex) =>
                  columnIndex === column ? nextState : cell,
                )
              : cellRow,
          ),
        },
      }
    })
  }

  const updateFloorMountDirection = (direction: FloorMountDirection) => {
    if (!floorGridEditor) {
      return
    }
    updateObject(floorGridEditor.objectId, (object) => {
      if (object.primitiveType !== 'floor') {
        return object
      }
      return {
        ...object,
        floor: {
          ...object.floor,
          mountDirection: direction,
        },
      }
    })
  }

  const openFloorGridEditor = () => {
    if (!sceneContextMenu) {
      return
    }
    setFloorGridEditor({
      objectId: sceneContextMenu.objectId,
      x: sceneContextMenu.x,
      y: sceneContextMenu.y,
    })
    closeSceneContextMenu()
  }

  const moveObject = (objectId: string, direction: -1 | 1) => {
    setObjects((current) => {
      const index = current.findIndex((object) => object.id === objectId)
      if (index === -1) {
        return current
      }
      const nextIndex = index + direction
      if (nextIndex < 0 || nextIndex >= current.length) {
        return current
      }
      const next = [...current]
      const [moved] = next.splice(index, 1)
      next.splice(nextIndex, 0, moved)
      return next
    })
    closeSceneContextMenu()
  }

  const deleteObject = (objectId: string) => {
    setObjects((current) => current.filter((object) => object.id !== objectId))
    setSelectedIds((current) => {
      const next = new Set(current)
      next.delete(objectId)
      return next
    })
    setFloorGridEditor((current) =>
      current?.objectId === objectId ? null : current,
    )
    closeSceneContextMenu()
  }

  const contextMenuObjectIndex =
    sceneContextMenu === null
      ? -1
      : objects.findIndex((object) => object.id === sceneContextMenu.objectId)
  const contextMenuObject =
    contextMenuObjectIndex === -1 ? null : objects[contextMenuObjectIndex]

  useEffect(() => {
    if (!sceneContextMenu) {
      return
    }

    sceneContextMenuRefs.setPositionReference({
      getBoundingClientRect: () =>
        DOMRect.fromRect({
          x: sceneContextMenu.x,
          y: sceneContextMenu.y,
          width: 0,
          height: 0,
        }),
    })
  }, [sceneContextMenu, sceneContextMenuRefs])

  useEffect(() => {
    if (selectedTool === 'fake') {
      return
    }

    if (
      (selectedTool === 'position' ||
        selectedTool === 'rotation' ||
        selectedTool === 'scale') &&
      !canUseTransformTools
    ) {
      setSelectedTool('fake')
      return
    }

    setSelectedIds((current) => {
      const next = new Set(
        [...current].filter((id) => {
          const object = objects.find((entry) => entry.id === id)
          return object ? isTransformableObject(object) : false
        }),
      )
      return next.size === current.size ? current : next
    })
  }, [canUseTransformTools, objects, selectedTool])

  useEffect(() => {
    if (sceneMode === 'drawn-surface') {
      setCameraMode('orthographic')
      if (selectedTool !== 'fake' && selectedTool !== 'drawn-surface') {
        setSelectedTool('drawn-surface')
      }
      return
    }

    if (sceneMode === 'selected-surface') {
      if (
        selectedTool !== 'fake' &&
        selectedTool !== 'selected-surface' &&
        selectedTool !== 'selected-surface-orientation' &&
        selectedTool !== 'selected-surface-position'
      ) {
        setSelectedTool('selected-surface')
      }
      return
    }

    if (sceneMode === 'pen') {
      if (selectedTool !== 'fake' && selectedTool !== 'pen') {
        setSelectedTool('pen')
      }
    }
  }, [sceneMode, selectedTool])

  if (error) {
    return <div className="p-2 text-sm text-destructive">{error}</div>
  }

  if (!item) {
    return <div className="p-2 text-sm text-muted-foreground">Loading...</div>
  }

  return (
    <div className="relative flex h-full min-h-full w-full flex-col">
      <input
        ref={importFileInputRef}
        type="file"
        className="hidden"
        onChange={handleImportFileChange}
      />
      <div className="pointer-events-none absolute top-2 right-2 z-10">
        <div className="mb-2 flex justify-end">
          <div className="flex h-24 w-24 items-center justify-center border border-border bg-background/85 backdrop-blur">
            <Canvas camera={{ position: [0, 0, 4], fov: 45 }}>
              <OrientationCube
                cameraOrientationRef={cameraOrientationRef}
                onAlignCamera={(axis) =>
                  setCameraAlignRequest({
                    axis,
                    nonce: Date.now(),
                  })
                }
              />
            </Canvas>
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute top-2 left-2 z-10 w-[18rem] max-w-[calc(100vw-1rem)]">
        <div className="pointer-events-auto border border-border bg-background/88 p-2 backdrop-blur">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-sm font-medium">Scene</div>
            <Button
              ref={refs.setReference}
              size="sm"
              variant="outline"
              {...getReferenceProps()}
            >
              <Plus className="size-4" />
              Add
            </Button>
          </div>

          {addMenuOpen ? (
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              className="z-20 min-w-36 border border-border bg-popover p-1 shadow-lg"
              {...getFloatingProps()}
            >
              <div className="relative">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-2 py-1 text-left text-sm hover:bg-muted"
                  onClick={() =>
                    setAddSubmenu((current) =>
                      current === 'primitives' ? null : 'primitives',
                    )
                  }
                >
                  <span className="flex items-center gap-2">
                    <Box className="size-4" />
                    Primitives
                  </span>
                  <ChevronRight className="size-4" />
                </button>
                {addSubmenu === 'primitives' ? (
                  <div className="absolute top-0 left-full z-30 ml-1 min-w-36 border border-border bg-popover p-1 shadow-lg">
                    {MESH_PRIMITIVES.map((entry) => (
                      <button
                        key={entry.kind}
                        type="button"
                        className="flex w-full items-center gap-2 px-2 py-1 text-left text-sm hover:bg-muted"
                        onClick={() => addPrimitive(entry.kind)}
                      >
                        <entry.icon className="size-4" />
                        {entry.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="relative">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-2 py-1 text-left text-sm hover:bg-muted"
                  onClick={() =>
                    setAddSubmenu((current) => (current === 'import' ? null : 'import'))
                  }
                >
                  <span className="flex items-center gap-2">
                    <FileUp className="size-4" />
                    Import
                  </span>
                  <ChevronRight className="size-4" />
                </button>
                {addSubmenu === 'import' ? (
                  <div className="absolute top-0 left-full z-30 ml-1 min-w-36 border border-border bg-popover p-1 shadow-lg">
                    {(['stl', 'glb', 'fbx'] as const).map((format) => (
                      <button
                        key={format}
                        type="button"
                        className="flex w-full items-center gap-2 px-2 py-1 text-left text-sm hover:bg-muted"
                        onClick={() => startImport(format)}
                      >
                        <FileUp className="size-4" />
                        {IMPORT_FORMAT_DETAILS[format].objectType}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className={`flex w-full items-center gap-2 px-2 py-1 text-left text-sm ${
                  hasFloor ? 'cursor-not-allowed opacity-40' : 'hover:bg-muted'
                }`}
                onClick={addFloor}
                disabled={hasFloor}
              >
                <Minus className="size-4" />
                Floor
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-2 py-1 text-left text-sm hover:bg-muted"
                onClick={enterDrawnSurfaceMode}
              >
                <PenLine className="size-4" />
                Drawn Surface
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-2 py-1 text-left text-sm hover:bg-muted"
                onClick={enterSelectedSurfaceMode}
              >
                <Shapes className="size-4" />
                Selected Surface
              </button>
              <button
                type="button"
                className={`flex w-full items-center gap-2 px-2 py-1 text-left text-sm ${
                  penAddEnabled ? 'hover:bg-muted' : 'cursor-not-allowed opacity-40'
                }`}
                onClick={enterPenMode}
                disabled={!penAddEnabled}
              >
                <Pencil className="size-4" />
                Pen
              </button>
            </div>
          ) : null}

          <div className="max-h-56 overflow-y-auto border border-border">
            {objects.length === 0 ? (
              <div className="p-2 text-sm text-muted-foreground">No objects yet.</div>
            ) : (
              <div className="flex flex-col">
                {sceneListEntries.map(({ object, depth }) => (
                  <button
                    key={object.id}
                    type="button"
                    className={`border-b border-border px-2 py-1.5 text-left text-sm last:border-b-0 ${
                      selectedIds.has(object.id) ? 'bg-muted' : ''
                    }`}
                    onClick={() => {
                      toggleSelection(object.id)
                      setPropertiesTab('general')
                    }}
                    onContextMenu={(event) => openSceneContextMenu(event, object.id)}
                  >
                    <div
                      className={depth === 1 ? 'pl-4' : undefined}
                    >
                      {object.name} - {depth === 1 ? `Child ${object.objectType}` : object.objectType}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {sceneContextMenu ? (
            <div
              ref={sceneContextMenuRefs.setFloating}
              style={sceneContextMenuStyles}
              className="z-30 min-w-36 border border-border bg-popover p-1 shadow-lg"
              {...getSceneContextMenuFloatingProps()}
            >
              {contextMenuObject?.primitiveType === 'floor' ? (
                <button
                  type="button"
                  className="flex w-full items-center px-2 py-1 text-left text-sm hover:bg-muted disabled:text-muted-foreground"
                  onClick={openFloorGridEditor}
                >
                  Grid
                </button>
              ) : null}
              <button
                type="button"
                className="flex w-full items-center px-2 py-1 text-left text-sm hover:bg-muted disabled:text-muted-foreground"
                onClick={() => deleteObject(sceneContextMenu.objectId)}
              >
                Delete
              </button>
              <button
                type="button"
                className="flex w-full items-center px-2 py-1 text-left text-sm hover:bg-muted disabled:text-muted-foreground"
                onClick={() => moveObject(sceneContextMenu.objectId, -1)}
                disabled={contextMenuObjectIndex <= 0}
              >
                Move Up
              </button>
              <button
                type="button"
                className="flex w-full items-center px-2 py-1 text-left text-sm hover:bg-muted disabled:text-muted-foreground"
                onClick={() => moveObject(sceneContextMenu.objectId, 1)}
                disabled={
                  contextMenuObjectIndex === -1 ||
                  contextMenuObjectIndex >= objects.length - 1
                }
              >
                Move Down
              </button>
            </div>
          ) : null}

          {floorGridEditor && floorGridObject ? (
            <div
              ref={floorGridRefs.setFloating}
              style={floorGridStyles}
              className="z-30 w-72 border border-border bg-popover p-2 shadow-lg"
              {...getFloorGridFloatingProps()}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-sm font-medium">{floorGridObject.name} Grid</div>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setFloorGridEditor(null)}
                >
                  Close
                </button>
              </div>

              <div className="mb-2 grid grid-cols-3 gap-2">
                {(
                  [
                    { id: 'eraser', label: 'Eraser' },
                    { id: 'mount', label: 'Mount Point' },
                    { id: 'flat', label: 'Flat' },
                  ] as const
                ).map((tool) => (
                  <button
                    key={tool.id}
                    type="button"
                    className={`h-8 border px-1 text-xs ${
                      floorGridTool === tool.id
                        ? 'border-primary text-foreground'
                        : 'border-border text-muted-foreground'
                    }`}
                    onClick={() => setFloorGridTool(tool.id)}
                  >
                    {tool.label}
                  </button>
                ))}
              </div>

              <div className="mb-2">
                <div className="mb-1 text-xs text-muted-foreground">Mount Direction</div>
                <div className="grid grid-cols-4 gap-2">
                  {(['left', 'right', 'up', 'down'] as const).map((direction) => (
                    <button
                      key={direction}
                      type="button"
                      className={`h-8 border px-1 text-xs capitalize ${
                        floorGridObject.floor.mountDirection === direction
                          ? 'border-primary text-foreground'
                          : 'border-border text-muted-foreground'
                      }`}
                      onClick={() => updateFloorMountDirection(direction)}
                    >
                      {direction}
                    </button>
                  ))}
                </div>
              </div>

              <div
                className="grid gap-px border border-border bg-border p-px"
                style={{
                  touchAction: 'none',
                  gridTemplateColumns: `repeat(${
                    floorGridObject.floor.cells[0]?.length ?? FLOOR_GRID_CELLS
                  }, minmax(0, 1fr))`,
                }}
              >
                {floorGridObject.floor.cells.map((cellRow, rowIndex) =>
                  cellRow.map((cell, columnIndex) => (
                    <button
                      key={`${rowIndex}-${columnIndex}`}
                      type="button"
                      className="aspect-square w-full"
                      style={{
                        backgroundColor:
                          cell === 'empty'
                            ? 'transparent'
                            : cell === 'mount'
                              ? FLOOR_MOUNT_COLOR
                              : FLOOR_FLAT_COLOR,
                      }}
                      onPointerDown={(event) => {
                        event.preventDefault()
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                          event.currentTarget.releasePointerCapture(event.pointerId)
                        }
                        floorGridPaintingRef.current = true
                        paintFloorGridCell(rowIndex, columnIndex)
                      }}
                      onPointerEnter={() => {
                        if (floorGridPaintingRef.current) {
                          paintFloorGridCell(rowIndex, columnIndex)
                        }
                      }}
                    />
                  )),
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div className="pointer-events-none mt-2 flex gap-2">
          <div className="inline-flex border border-border bg-background/85 px-2 py-1 text-xs text-muted-foreground backdrop-blur">
            {toolActive ? 'Tool Active' : 'Tool Idle'}
          </div>
          <div className="inline-flex border border-border bg-background/85 px-2 py-1 text-xs text-muted-foreground capitalize backdrop-blur">
            {getSceneModeLabel(sceneMode)}
          </div>
        </div>
      </div>

      <div className="absolute right-2 bottom-2 z-10 w-[22rem] max-w-[calc(100vw-1rem)]">
        <div className="border border-border bg-background/90 backdrop-blur">
          <button
            type="button"
            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium"
            onClick={() => setDebugOpen((current) => !current)}
          >
            <span>Debug</span>
            <span className="text-xs text-muted-foreground">
              {debugOpen ? 'Hide' : 'Show'}
            </span>
          </button>
          {debugOpen ? (
            <div
              ref={debugContainerRef}
              className="max-h-56 overflow-y-auto border-t border-border px-3 py-2 font-mono text-xs text-muted-foreground"
              onScroll={(event) => {
                const element = event.currentTarget
                const distanceFromBottom =
                  element.scrollHeight - element.scrollTop - element.clientHeight
                debugStickToBottomRef.current = distanceFromBottom < 12
              }}
            >
              {debugLogs.length === 0 ? (
                <div>No debug logs yet.</div>
              ) : (
                <div className="flex flex-col gap-1">
                  {debugLogs.map((log, index) => (
                    <div key={`${index}-${log}`}>{log}</div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <div className="absolute bottom-2 left-2 z-10 flex max-w-[calc(100vw-1rem)] flex-col gap-2">
        <div className="w-[20rem] max-w-[calc(100vw-1rem)] border border-border bg-background/90 p-2 backdrop-blur">
          <div className="grid grid-cols-4 gap-2">
            {toolOptions.map((toolOption) => {
              const Icon = toolOption.icon
              const active = selectedTool === toolOption.id
              return (
                <button
                  key={toolOption.id}
                  type="button"
                  className={`flex h-12 items-center justify-center border ${
                    active
                      ? 'border-primary text-foreground'
                      : 'border-border text-muted-foreground'
                  }`}
                  onClick={() => setSelectedTool(toolOption.id)}
                  title={toolOption.label}
                >
                  <Icon className="size-4" />
                </button>
              )
            })}
          </div>
          {sceneMode === 'drawn-surface' ||
          sceneMode === 'selected-surface' ||
          sceneMode === 'pen' ? (
            <div className="mt-2">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="h-9 border border-border px-2 text-sm text-muted-foreground"
                  onClick={
                    sceneMode === 'drawn-surface'
                      ? cancelDrawnSurface
                      : sceneMode === 'selected-surface'
                        ? cancelSelectedSurface
                        : cancelPen
                  }
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="h-9 border border-primary px-2 text-sm text-foreground disabled:border-border disabled:text-muted-foreground"
                  onClick={
                    sceneMode === 'drawn-surface'
                      ? completeDrawnSurface
                      : sceneMode === 'selected-surface'
                        ? completeSelectedSurface
                        : completePen
                  }
                  disabled={
                    sceneMode === 'drawn-surface'
                      ? !drawnSurfaceDraft || drawnSurfaceDraft.worldPoints.length < 3
                      : sceneMode === 'selected-surface'
                        ? selectedSurfaceFaces.length === 0 || !selectedSurfaceOrientationFace
                        : !penDraft || penDraft.strokes.every((stroke) => stroke.length < 2)
                  }
                >
                  Complete
                </button>
              </div>
            </div>
          ) : null}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              className={`h-9 border px-2 text-sm ${
                cameraMode === 'perspective'
                  ? 'border-primary text-foreground'
                  : 'border-border text-muted-foreground'
              }`}
              onClick={() => setCameraMode('perspective')}
              disabled={sceneMode === 'drawn-surface'}
            >
              Perspective
            </button>
            <button
              type="button"
              className={`h-9 border px-2 text-sm ${
                cameraMode === 'orthographic'
                  ? 'border-primary text-foreground'
                  : 'border-border text-muted-foreground'
              }`}
              onClick={() => setCameraMode('orthographic')}
            >
              Orthographic
            </button>
          </div>
        </div>

        {sceneMode === 'general' && selectedObject ? (
          <div className="w-[20rem] max-w-[calc(100vw-1rem)] border border-border bg-background/90 p-3 backdrop-blur">
            <div className="mb-3 text-sm font-medium">Object Properties</div>
            <div className="mb-3 flex gap-2">
              {availablePropertyTabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`h-9 border px-3 text-sm ${
                    propertiesTab === tab
                      ? 'border-primary text-foreground'
                      : 'border-border text-muted-foreground'
                  }`}
                  onClick={() => setPropertiesTab(tab)}
                >
                  {tab === 'general'
                    ? 'General'
                    : tab === 'mesh'
                      ? 'Mesh'
                      : tab === 'floor'
                        ? 'Floor'
                        : 'Pen'}
                </button>
              ))}
            </div>

            {propertiesTab === 'general' ? (
              <>
                <label className="mb-3 flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Name</span>
                  <input
                    type="text"
                    value={selectedObject.name}
                    onChange={(event) => updateSelectedObjectName(event.target.value)}
                    className="h-9 border border-border bg-background px-2 text-sm outline-none"
                  />
                </label>

                <label className="mb-3 flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">ID</span>
                  <input
                    type="text"
                    value={selectedObject.id}
                    readOnly
                    className="h-9 border border-border bg-muted px-2 text-sm text-muted-foreground outline-none"
                  />
                </label>

                {isTransformableObject(selectedObject) ? (
                  <>
                    <div className="mb-3">
                      <div className="mb-1 text-xs text-muted-foreground">Position</div>
                      <div className="grid grid-cols-3 gap-2">
                        {(['X', 'Y', 'Z'] as const).map((axis, index) => (
                          <label key={`position-${axis}`} className="flex flex-col gap-1">
                            <span className="text-[11px] text-muted-foreground">{axis}</span>
                            <input
                              type="number"
                              step="0.1"
                              value={selectedObject.position[index]}
                              onChange={(event) =>
                                updateSelectedTransformTupleValue(
                                  'position',
                                  index as 0 | 1 | 2,
                                  event.target.value,
                                )
                              }
                              className="h-9 border border-border bg-background px-2 text-sm outline-none"
                            />
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="mb-3">
                      <div className="mb-1 text-xs text-muted-foreground">Rotation</div>
                      <div className="grid grid-cols-3 gap-2">
                        {(['X', 'Y', 'Z'] as const).map((axis, index) => (
                          <label key={`rotation-${axis}`} className="flex flex-col gap-1">
                            <span className="text-[11px] text-muted-foreground">{axis}</span>
                            <input
                              type="number"
                              step="1"
                              value={
                                Math.round(
                                  radiansToDegrees(selectedObject.rotation[index]) * 1000,
                                ) / 1000
                              }
                              onChange={(event) =>
                                updateSelectedTransformTupleValue(
                                  'rotation',
                                  index as 0 | 1 | 2,
                                  event.target.value,
                                )
                              }
                              className="h-9 border border-border bg-background px-2 text-sm outline-none"
                            />
                          </label>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="mb-1 text-xs text-muted-foreground">Scale</div>
                      <div className="grid grid-cols-3 gap-2">
                        {(['X', 'Y', 'Z'] as const).map((axis, index) => (
                          <label key={`scale-${axis}`} className="flex flex-col gap-1">
                            <span className="text-[11px] text-muted-foreground">{axis}</span>
                            <input
                              type="number"
                              step="0.1"
                              value={selectedObject.scale[index]}
                              onChange={(event) =>
                                updateSelectedTransformTupleValue(
                                  'scale',
                                  index as 0 | 1 | 2,
                                  event.target.value,
                                )
                              }
                              className="h-9 border border-border bg-background px-2 text-sm outline-none"
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  </>
                ) : null}
              </>
            ) : null}

            {propertiesTab === 'mesh' && selectedObject.objectType === 'Mesh' ? (
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Color</div>
                <input
                  type="color"
                  value={selectedObject.mesh.color}
                  onChange={(event) => updateSelectedObjectMeshColor(event.target.value)}
                  className="h-10 w-full border border-border bg-background px-1"
                />
              </div>
            ) : null}

            {propertiesTab === 'floor' && selectedObject.primitiveType === 'floor' ? (
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Height</div>
                <input
                  type="number"
                  step="0.05"
                  min="0.05"
                  value={selectedObject.floor.height}
                  onChange={(event) => updateSelectedFloorHeight(event.target.value)}
                  className="h-9 w-full border border-border bg-background px-2 text-sm outline-none"
                />
              </div>
            ) : null}

            {propertiesTab === 'pen' && selectedObject.primitiveType === 'pen' ? (
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Stroke Width</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.001"
                    value={selectedObject.pen.strokeWidth}
                    onChange={(event) =>
                      updateSelectedPenValue('strokeWidth', event.target.value)
                    }
                    className="h-9 border border-border bg-background px-2 text-sm outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Stroke Depth</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.001"
                    value={selectedObject.pen.strokeDepth}
                    onChange={(event) =>
                      updateSelectedPenValue('strokeDepth', event.target.value)
                    }
                    className="h-9 border border-border bg-background px-2 text-sm outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Cylindrical Divisions</span>
                  <input
                    type="number"
                    step="1"
                    min="3"
                    value={selectedObject.pen.cylindricalDivisions}
                    onChange={(event) =>
                      updateSelectedPenValue(
                        'cylindricalDivisions',
                        event.target.value,
                      )
                    }
                    className="h-9 border border-border bg-background px-2 text-sm outline-none"
                  />
                </label>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div
        className="min-h-0 flex-1 select-none"
        style={{
          WebkitUserSelect: 'none',
          userSelect: 'none',
          WebkitTouchCallout: 'none',
        }}
      >
        <Canvas camera={{ position: [3, 3, 3], fov: 55, near: 0.01, far: 5000 }}>
          <color attach="background" args={['#111111']} />
          <SceneCameraRig
            cameraMode={cameraMode}
            cameraTargetRef={cameraTargetRef}
            cameraAlignRequest={cameraAlignRequest}
          />
          <ambientLight intensity={0.28} />
          <hemisphereLight
            args={['#d6f4dc', '#0f1512', 1.1]}
          />
          <directionalLight position={[6, 8, 5]} intensity={1.45} color="#fff4d9" />
          <directionalLight position={[-5, 3, -6]} intensity={0.7} color="#b9d7ff" />
          <pointLight position={[0, 5, 0]} intensity={0.35} color="#d7ffe4" />
          <SceneObjects objects={objects} selectedIds={selectedIds} />
          <DrawnSurfaceDraftLine draft={drawnSurfaceDraft} />
          <PenDraftOverlay draft={penDraft} surfaceNormal={penDraftSurfaceNormal} />
          <SelectedSurfaceDraftOverlay faces={selectedSurfaceFaces} />
          <SelectedSurfaceDraftOverlay
            faces={selectedSurfacePositionFaces}
            color="#7dd3fc"
            opacity={0.55}
          />
          <SelectedSurfaceDraftOverlay
            faces={selectedSurfaceOrientationFace ? [selectedSurfaceOrientationFace] : []}
            color="#fbbf24"
            opacity={0.7}
          />
          <TransformGizmo tool={selectedTool} objects={transformSelectedObjects} />
          <CameraControls
            activeTool={selectedTool}
            cameraOrientationRef={cameraOrientationRef}
            cameraTargetRef={cameraTargetRef}
            onSelectedSurfaceFacePick={toggleSelectedSurfaceFace}
            penProjectionSurfaceId={penProjectionSurfaceId}
            sceneMode={sceneMode}
            selectedObjects={transformSelectedObjects}
            onTransformSelection={applyTransformSelection}
            onToolActiveChange={setToolActive}
            toolHandlers={toolHandlers}
          />
        </Canvas>
      </div>
    </div>
  )
}
