declare module 'three/examples/jsm/controls/OrbitControls.js' {
  import type { Camera } from 'three'

  export class OrbitControls {
    constructor(object: Camera, domElement?: HTMLElement)
    enableDamping: boolean
    enabled: boolean
    target: {
      x: number
      y: number
      z: number
      add(value: { x: number; y: number; z: number }): void
    }
    mouseButtons: {
      LEFT: number
      MIDDLE: number
      RIGHT: number
    }
    touches: {
      ONE: number
      TWO: number
    }
    update(): void
    dispose(): void
  }
}
