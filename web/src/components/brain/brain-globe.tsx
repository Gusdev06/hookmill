"use client"

import { useEffect, useRef } from "react"
import ForceGraph3D, { type ForceGraph3DInstance } from "3d-force-graph"
import * as THREE from "three"
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js"
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { CAT_COLOR, endId, hexA, LIME, type BrainIndex, type GLink, type GNode } from "@/lib/brain-graph"

/*
 * The Brain globe (brain-3d-v1 §3, spec §4): the same engine as the /3d-brain skill (3d-force-graph + three + bloom),
 * imperative inside one effect. Loaded ONLY by app/(app)/brain/page.tsx through next/dynamic (ssr: false), so three.js
 * never lands in another route's bundle. Ported from apps/3d-brain/src: composeGlobe (lib/brain-graph layout),
 * makeOrbitals, the growth replay and the label declutter (here a 24-label DOM pool instead of one CSS2D label per node).
 */
export interface BrainGlobeProps {
  ix: BrainIndex
  visibleIds: ReadonlySet<string>
  selectedId: string | null
  /** auto-rotation + particles (Pause motion) */
  motion: boolean
  /** prefers-reduced-motion: no rotation, no particles, no bloom, camera jumps, Grow shows the end state */
  reduced: boolean
  /** phone: no bloom, lower pixel ratio */
  lite: boolean
  /** increments start a Grow replay */
  growToken: number
  growMs: number
  onSelect: (id: string | null) => void
  onHover: (id: string | null) => void
  /** WebGL context could not be created: the screen falls back to the List */
  onFail: () => void
  onGrowEnd?: () => void
}

type Graph = ForceGraph3DInstance<GNode, GLink>
interface Parts { mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>; halo: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>; ring: THREE.Sprite | null; sel: THREE.Sprite; r: number }

const sphereGeo = new THREE.SphereGeometry(1, 18, 14)
const haloGeo = new THREE.SphereGeometry(1, 12, 10)
let ringTex: THREE.CanvasTexture | null = null
function ringTexture() {
  if (ringTex) return ringTex
  const c = document.createElement("canvas")
  c.width = c.height = 128
  const g = c.getContext("2d")!
  g.strokeStyle = "#ffffff"
  g.lineWidth = 9
  g.beginPath()
  g.arc(64, 64, 52, 0, Math.PI * 2)
  g.stroke()
  ringTex = new THREE.CanvasTexture(c)
  return ringTex
}

function radiusOf(n: GNode) {
  if (n.category === "center") return 14
  if (n.meta.kind === "meta_ad") return Math.min(11, 3 + Math.sqrt(n.weight) * 6)
  let r = 2.4 + Math.sqrt(n.deg) * 0.85 + n.weight * 1.6
  if (n.winner) r += 1.2
  return Math.min(r, 10)
}

function makeStarfield() {
  const count = 900
  const pos = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const r = 1400 + Math.random() * 1600
    const t = Math.random() * Math.PI * 2
    const p = Math.acos(2 * Math.random() - 1)
    pos[i * 3] = r * Math.sin(p) * Math.cos(t)
    pos[i * 3 + 1] = r * Math.sin(p) * Math.sin(t)
    pos[i * 3 + 2] = r * Math.cos(p)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3))
  return new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x9fb8ff, size: 1.4, sizeAttenuation: true, transparent: true, opacity: 0.32, depthWrite: false }))
}

/** makeOrbitals of the skill: two tilted rings with a bead + a wireframe core + a glow (lime-tinted: the client). */
function makeOrbitals(scene: THREE.Scene) {
  const group = new THREE.Group()
  scene.add(group)
  const rings: { ring: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>; bead: THREE.Mesh; radius: number }[] = []
  for (let i = 0; i < 2; i++) {
    const radius = 500 + i * 36
    const pts = Array.from({ length: 241 }, (_, j) => {
      const a = (j / 240) * Math.PI * 2
      return new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0)
    })
    const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: i ? 0x67e8f9 : 0x91aaff, transparent: true, opacity: 0.12, depthWrite: false }))
    ring.rotation.set(i ? 0.9 : -0.5, i ? -0.45 : 0.4, 0.2)
    group.add(ring)
    const bead = new THREE.Mesh(new THREE.SphereGeometry(2.8, 10, 8), new THREE.MeshBasicMaterial({ color: 0xb9f5ff }))
    ring.add(bead)
    rings.push({ ring, bead, radius })
  }
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(44, 1), new THREE.MeshBasicMaterial({ color: 0xc8f03c, wireframe: true, transparent: true, opacity: 0.1, depthWrite: false }))
  group.add(core)
  const c = document.createElement("canvas")
  c.width = c.height = 128
  const g = c.getContext("2d")!
  const glow = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  glow.addColorStop(0, "rgba(200,240,60,.42)")
  glow.addColorStop(0.25, "rgba(120,200,230,.10)")
  glow.addColorStop(1, "rgba(20,60,100,0)")
  g.fillStyle = glow
  g.fillRect(0, 0, 128, 128)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
  sprite.scale.set(330, 330, 1)
  group.add(sprite)
  return {
    update(t: number, focused: boolean, reveal: number) {
      core.rotation.set(t * 0.09, t * 0.12, 0)
      sprite.material.opacity = focused ? 0.25 : 0.7 + Math.sin(t * 0.7) * 0.1
      rings.forEach(({ ring, bead, radius }, i) => {
        ring.visible = reveal > 0.01
        ring.scale.setScalar(0.2 + 0.8 * Math.min(1, reveal))
        ring.rotation.z = t * (i ? -0.018 : 0.012)
        bead.position.set(Math.cos(t * 0.16 + i * 2) * radius, Math.sin(t * 0.16 + i * 2) * radius, 0)
        ring.material.opacity = (focused ? 0.035 : 0.12) * Math.min(1, reveal)
      })
    },
  }
}

export default function BrainGlobe(props: BrainGlobeProps) {
  const host = useRef<HTMLDivElement>(null)
  const labelsHost = useRef<HTMLDivElement>(null)
  // latest props for the imperative engine (read inside callbacks, never re-creating the scene)
  const P = useRef(props)
  useEffect(() => {
    P.current = props
  })
  const api = useRef<{ restyle: () => void; data: () => void; fly: (id: string | null) => void; motion: () => void; grow: () => void } | null>(null)

  useEffect(() => {
    const el = host.current
    const labelEl = labelsHost.current
    if (!el || !labelEl) return
    let graph: Graph
    try {
      graph = new (ForceGraph3D as unknown as new (el: HTMLElement, c: object) => Graph)(el, { controlType: "orbit", rendererConfig: { antialias: true, alpha: false, powerPreference: "high-performance" } })
    } catch {
      P.current.onFail()
      return
    }
    const parts = new Map<string, Parts>()
    let hovered: string | null = null
    let hl = new Set<string>()
    let hlLinks = new Set<GLink>()
    let particleLinks = new Set<GLink>()
    let growth: { start: number; dur: number; t: number; lastPaint: number } | null = null
    let idle: ReturnType<typeof setTimeout> | undefined
    let raf = 0
    let alive = true
    let w = el.clientWidth || 800
    let h = el.clientHeight || 600
    const controls = graph.controls() as OrbitControls
    const overview = () => (w < 700 ? Math.max(1750, (h / w) * 1250) : 1500)
    const focusId = () => P.current.selectedId ?? hovered
    const shown = (n: GNode) => P.current.visibleIds.has(n.id) && (!growth || n.born <= growth.t)
    const linkShown = (l: GLink) => {
      const a = P.current.ix.byId.get(endId(l.source))
      const b = P.current.ix.byId.get(endId(l.target))
      if (!a || !b || !shown(a) || !shown(b)) return false
      if (growth) return true
      return hlLinks.has(l) || (!focusId() && l.quiet)
    }
    const colorOf = (n: GNode) => (n.category === "center" ? LIME : CAT_COLOR[n.category])
    const linkColor = (l: GLink) => {
      const a = P.current.ix.byId.get(endId(l.source))!
      const b = P.current.ix.byId.get(endId(l.target))!
      const f = focusId()
      if (f) return hlLinks.has(l) ? hexA(colorOf(a.id === f ? b : a), 0.5) : "rgba(140,160,200,0.035)"
      return hexA(colorOf(a.category === "center" ? b : a), growth ? 0.28 : 0.1)
    }
    const motionOn = () => P.current.motion && !P.current.reduced
    const particles = (l: GLink) => (motionOn() && !growth && particleLinks.has(l) && linkShown(l) ? 2 : 0)

    function computeHighlight() {
      hl = new Set()
      hlLinks = new Set()
      particleLinks = new Set()
      const f = focusId()
      if (!f) return
      hl.add(f)
      const adj = P.current.ix.adj.get(f) ?? []
      const vis = adj.filter((e) => P.current.visibleIds.has(e.id))
      for (const e of vis) hl.add(e.id)
      vis.slice(0, 72).forEach((e) => hlLinks.add(e.link))
      vis.slice(0, 24).forEach((e) => particleLinks.add(e.link))
    }

    function makeNode(n: GNode) {
      const group = new THREE.Group()
      const color = new THREE.Color(colorOf(n))
      const r = radiusOf(n)
      const mesh = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }))
      mesh.scale.setScalar(r)
      group.add(mesh)
      const halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.07, depthWrite: false }))
      halo.scale.setScalar(r * 1.5)
      group.add(halo)
      let ring: THREE.Sprite | null = null
      if (n.winner) {
        ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture(), color: new THREE.Color(LIME), transparent: true, depthWrite: false }))
        ring.scale.setScalar(r * 3.1)
        group.add(ring)
      }
      const sel = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture(), color: 0xffffff, transparent: true, depthWrite: false, opacity: 0.9 }))
      sel.scale.setScalar(r * 4.2)
      sel.visible = false
      group.add(sel)
      parts.set(n.id, { mesh, halo, ring, sel, r })
      style(n)
      return group
    }

    function style(n: GNode) {
      const p = parts.get(n.id)
      if (!p) return
      const f = focusId()
      const on = hl.has(n.id)
      const isSel = P.current.selectedId === n.id
      const dim = !!f && !on
      p.mesh.material.opacity = dim ? 0.16 : 0.92
      p.halo.material.opacity = dim ? 0 : isSel ? 0.22 : 0.06
      const s = isSel ? 1.5 : on && f ? 1.15 : 1
      p.mesh.scale.setScalar(p.r * s)
      p.halo.scale.setScalar(p.r * 1.5 * s)
      if (p.ring) {
        p.ring.material.opacity = dim ? 0.15 : 0.95
        p.ring.scale.setScalar(p.r * 3.1 * s)
      }
      p.sel.visible = isSel
      p.sel.scale.setScalar(p.r * 4.2 * s)
    }

    function restyle() {
      computeHighlight()
      for (const n of P.current.ix.nodes) style(n)
      graph.nodeVisibility(shown).linkVisibility(linkShown).linkColor(linkColor).linkDirectionalParticles(particles)
      pickLabels()
    }

    // ───── labels: a pool of DOM labels placed every frame, decluttered every 180 ms
    const pool: HTMLSpanElement[] = []
    let labelNodes: GNode[] = []
    let lastDeclutter = 0
    const accepted = new Set<number>()
    function pickLabels() {
      const ix = P.current.ix
      const f = focusId()
      if (growth) labelNodes = []
      else if (f) {
        const c = ix.byId.get(f)
        const neigh = (ix.adj.get(f) ?? []).map((e) => ix.byId.get(e.id)!).filter((n) => P.current.visibleIds.has(n.id)).sort((a, b) => Number(b.winner) - Number(a.winner) || b.deg - a.deg)
        labelNodes = c ? [c, ...neigh.filter((n) => n.id !== f).slice(0, 12)] : []
      } else labelNodes = ix.nodes.filter((n) => (ix.hubs.has(n.id) || n.category === "center") && P.current.visibleIds.has(n.id))
      labelNodes = labelNodes.slice(0, 24)
      while (pool.length < labelNodes.length) {
        const s = document.createElement("span")
        s.className = "pointer-events-none absolute top-0 left-0 whitespace-nowrap text-[12px] font-medium text-[#F2F3EE] will-change-transform [text-shadow:0_0_6px_#000,0_0_14px_#000,0_1px_2px_#000]"
        labelEl!.appendChild(s)
        pool.push(s)
      }
      pool.forEach((s, i) => {
        const n = labelNodes[i]
        if (!n) {
          s.style.display = "none"
          return
        }
        s.style.display = "block"
        const isMain = n.id === f || (!f && n.category === "center")
        s.textContent = n.label.length > 34 ? n.label.slice(0, 33) + "…" : n.label
        s.style.fontWeight = isMain ? "600" : "500"
        s.style.fontSize = isMain ? "13px" : "12px"
        s.dataset.main = isMain ? "1" : ""
      })
      lastDeclutter = 0
    }
    function placeLabels(now: number) {
      const boxes: { l: number; r: number; t: number; b: number }[] = []
      const doDeclutter = now - lastDeclutter > 180
      if (doDeclutter) {
        lastDeclutter = now
        accepted.clear()
      }
      labelNodes.forEach((n, i) => {
        const s = pool[i]
        if (n.x === undefined) return
        const c = graph.graph2ScreenCoords(n.x, n.y!, n.z!)
        const lw = s.offsetWidth || n.label.length * 6.5
        const x = c.x - lw / 2
        const y = c.y - radiusOf(n) - 24
        s.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
        if (doDeclutter) {
          const box = { l: x - 4, r: x + lw + 4, t: y - 3, b: y + 18 }
          const off = box.l < 4 || box.r > w - 4 || c.y < 60 || c.y > h - 50
          const overlap = boxes.some((o) => box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t)
          if (s.dataset.main || (!off && !overlap)) {
            boxes.push(box)
            accepted.add(i)
          }
          s.style.visibility = accepted.has(i) ? "visible" : "hidden"
        }
      })
    }

    // ───── graph setup (the skill's options)
    graph
      .width(w)
      .height(h)
      .backgroundColor("#0E1012")
      .showNavInfo(false)
      .nodeLabel(() => "")
      .nodeThreeObject(makeNode)
      .nodeThreeObjectExtend(false)
      .nodeVisibility(shown)
      .linkVisibility(linkShown)
      .linkColor(linkColor)
      .linkOpacity(1)
      .linkWidth(0)
      .linkDirectionalParticles(particles)
      .linkDirectionalParticleWidth(1.6)
      .linkDirectionalParticleSpeed(0.005)
      .linkDirectionalParticleColor(() => "#ffffff")
      .onNodeClick((n) => {
        if (growth) return
        P.current.onSelect(n.id)
      })
      .onNodeHover((n) => {
        if (growth) return
        hovered = n?.id ?? null
        el.style.cursor = n ? "pointer" : "grab"
        P.current.onHover(hovered)
        if (!P.current.selectedId) restyle()
      })
      .onBackgroundClick(() => {
        if (P.current.selectedId) P.current.onSelect(null)
      })
      .enableNodeDrag(false)
      .warmupTicks(0)
      .cooldownTicks(0)
    graph.d3Force("charge", null)
    graph.d3Force("center", null)
    graph.d3Force("link")?.strength(0)

    const scene = graph.scene()
    scene.add(makeStarfield())
    scene.fog = new THREE.FogExp2(0x0e1012, 0.00015)
    const orbitals = makeOrbitals(scene)
    const renderer = graph.renderer()
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, P.current.lite ? 1.25 : 1.6))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    let bloom: UnrealBloomPass | null = null
    if (!P.current.lite && !P.current.reduced) {
      bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.45, 0.45, 0.65)
      graph.postProcessingComposer().addPass(bloom)
      // the bloom composer encodes to sRGB a second time: a near-black clear color lands on the stage #0E1012
      graph.backgroundColor("#010102")
    }

    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.autoRotateSpeed = 0.45
    controls.minDistance = 60
    controls.maxDistance = 3000
    controls.autoRotate = motionOn()
    const jump = () => P.current.reduced
    graph.cameraPosition({ x: 0, y: 90, z: overview() * (motionOn() ? 1.3 : 1) })
    const intro = setTimeout(() => graph.cameraPosition({ x: 0, y: 55, z: overview() }, { x: 0, y: 0, z: 0 }, motionOn() ? 2000 : 0), 200)
    const scheduleRotate = () => {
      clearTimeout(idle)
      if (!motionOn()) return
      idle = setTimeout(() => {
        if (motionOn() && !P.current.selectedId) controls.autoRotate = true
      }, 5000)
    }
    const onStart = () => {
      controls.autoRotate = false
      clearTimeout(idle)
    }
    controls.addEventListener("start", onStart)
    controls.addEventListener("end", scheduleRotate)

    function data() {
      parts.clear()
      graph.graphData({ nodes: P.current.ix.nodes, links: P.current.ix.links })
      restyle()
    }

    function fly(id: string | null) {
      const n = id ? P.current.ix.byId.get(id) : null
      if (!n || n.x === undefined) {
        graph.cameraPosition({ x: 0, y: 55, z: overview() }, { x: 0, y: 0, z: 0 }, jump() ? 0 : 1100)
        scheduleRotate()
        return
      }
      const dist = 380 + radiusOf(n) * 12 + Math.min(n.deg, 300) * 1.5
      const r = Math.hypot(n.x, n.y!, n.z!)
      const cam = graph.camera().position
      const cr = Math.hypot(cam.x, cam.y, cam.z) || 1
      const dir = r > 40 ? { x: n.x / r, y: n.y! / r, z: n.z! / r } : { x: cam.x / cr, y: cam.y / cr, z: cam.z / cr }
      // the drawer covers the right 412 px on desktop: aim a bit to the right of the node so it lands in the free area
      graph.cameraPosition({ x: n.x + dir.x * dist, y: n.y! + dir.y * dist * 0.6 + 10, z: n.z! + dir.z * dist }, { x: n.x, y: n.y!, z: n.z! }, jump() ? 0 : 1100)
      controls.autoRotate = false
      clearTimeout(idle)
    }

    function setMotion() {
      controls.autoRotate = motionOn() && !P.current.selectedId
      graph.linkDirectionalParticleSpeed(motionOn() ? 0.005 : 0)
      graph.linkDirectionalParticles(particles)
    }

    function grow() {
      if (P.current.reduced) {
        P.current.onGrowEnd?.()
        return
      }
      growth = { start: performance.now(), dur: P.current.growMs, t: 0, lastPaint: -1 }
      hovered = null
      for (const n of P.current.ix.nodes) n.fx = n.fy = n.fz = 0
      graph.cooldownTicks(Infinity).cooldownTime(Infinity).d3ReheatSimulation()
      graph.cameraPosition({ x: 0, y: 25, z: overview() * 0.6 }, { x: 0, y: 0, z: 0 }, 0)
      controls.autoRotate = true
      controls.autoRotateSpeed = 0.25
      restyle()
    }
    function stepGrowth(now: number) {
      if (!growth) return
      const t = Math.min(1, (now - growth.start) / growth.dur)
      growth.t = t
      for (const n of P.current.ix.nodes) {
        if (n.born > t || n.x === undefined) continue
        // spring from the center to home, the skill's growthPosition
        const age = Math.min(1, ((t - n.born) * growth.dur) / 900)
        const spring = age >= 1 ? 1 : 1 - Math.exp(-5 * age) * Math.cos(7 * age)
        const spread = 0.35 + 0.65 * Math.min(1, t * 1.15)
        const home = homeOf(n)
        n.fx = home.x * spread * spring
        n.fy = home.y * spread * spring
        n.fz = home.z * spread * spring
        const p = parts.get(n.id)
        if (p) {
          const appear = Math.min(1, Math.max(0.05, age / 0.6))
          p.mesh.scale.setScalar(p.r * (0.3 + 0.7 * appear))
          p.mesh.material.opacity = 0.95 * appear
        }
      }
      graph.camera().position.setLength(overview() * (0.6 + 0.4 * Math.min(1, t * 1.2)))
      if (now - growth.lastPaint > 120 || t === 1) {
        growth.lastPaint = now
        graph.nodeVisibility(shown).linkVisibility(linkShown).linkColor(linkColor)
      }
      if (t === 1) {
        growth = null
        for (const n of P.current.ix.nodes) {
          const home = homeOf(n)
          n.fx = home.x
          n.fy = home.y
          n.fz = home.z
        }
        graph.cooldownTicks(0).d3ReheatSimulation()
        controls.autoRotateSpeed = 0.45
        controls.autoRotate = motionOn() && !P.current.selectedId
        restyle()
        P.current.onGrowEnd?.()
      }
    }
    // homes are the layout positions computed by indexGraph (x/y/z at index time)
    const homes = new Map<string, { x: number; y: number; z: number }>()
    const homeOf = (n: GNode) => {
      let hp = homes.get(n.id)
      if (!hp) {
        hp = { x: n.x ?? 0, y: n.y ?? 0, z: n.z ?? 0 }
        homes.set(n.id, hp)
      }
      return hp
    }

    api.current = {
      restyle,
      data: () => {
        homes.clear()
        for (const n of P.current.ix.nodes) homeOf(n)
        data()
      },
      fly,
      motion: setMotion,
      grow: () => {
        homes.clear()
        for (const n of P.current.ix.nodes) homeOf(n)
        grow()
      },
    }
    for (const n of P.current.ix.nodes) homeOf(n)
    data()

    let elapsed = 0
    let prev = performance.now()
    const loop = (now: number) => {
      if (!alive) return
      const dt = Math.min((now - prev) / 1000, 0.05)
      prev = now
      if (motionOn() && !document.hidden) elapsed += dt
      orbitals.update(elapsed, !!focusId(), growth ? Math.max(0, (growth.t - 0.3) / 0.7) : 1)
      stepGrowth(now)
      placeLabels(now)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    // size + pause when hidden / off screen
    const ro = new ResizeObserver(() => {
      w = el.clientWidth
      h = el.clientHeight
      if (!w || !h) return
      graph.width(w).height(h)
      bloom?.setSize(w, h)
    })
    ro.observe(el)
    let onScreen = true
    const sync = () => {
      if (document.hidden || !onScreen) graph.pauseAnimation()
      else graph.resumeAnimation()
    }
    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting
      sync()
    })
    io.observe(el)
    document.addEventListener("visibilitychange", sync)

    return () => {
      alive = false
      cancelAnimationFrame(raf)
      clearTimeout(idle)
      clearTimeout(intro)
      ro.disconnect()
      io.disconnect()
      document.removeEventListener("visibilitychange", sync)
      controls.removeEventListener("start", onStart)
      controls.removeEventListener("end", scheduleRotate)
      api.current = null
      graph._destructor()
      renderer.dispose()
      renderer.forceContextLoss()
      el.replaceChildren()
      labelEl.replaceChildren()
    }
  }, [])

  // data, filters, selection, motion, grow → the engine
  const { ix, visibleIds, selectedId, motion, growToken } = props
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    api.current?.data()
  }, [ix])
  useEffect(() => {
    api.current?.restyle()
  }, [visibleIds, selectedId])
  useEffect(() => {
    api.current?.fly(selectedId)
  }, [selectedId])
  useEffect(() => {
    api.current?.motion()
  }, [motion])
  useEffect(() => {
    if (growToken > 0) api.current?.grow()
  }, [growToken])

  return (
    <div className="absolute inset-0" aria-hidden="true">
      <div ref={host} className="absolute inset-0 touch-none cursor-grab [&_canvas]:block" />
      <div ref={labelsHost} className="pointer-events-none absolute inset-0 overflow-hidden" />
    </div>
  )
}
