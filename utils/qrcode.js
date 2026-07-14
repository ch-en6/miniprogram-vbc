// utils/qrcode.js — Canvas QR 码绘制工具（简化版，生成可扫描的 QR Code）
// 支持 Version 1-4，字节模式，L 级纠错

const QR = (() => {
  // ─── QR 码常量 ───
  const CAPACITY = [0, 17, 32, 53, 78]
  const TOTAL_CODEWORDS = [0, 26, 44, 70, 100]
  const EC_CODEWORDS = [0, 7, 10, 15, 20]
  const DATA_CODEWORDS = [0, 19, 34, 55, 80]
  const SIZE = [0, 21, 25, 29, 33]

  // GF(256) 运算表
  const EXP = new Uint8Array(256)
  const LOG = new Uint8Array(256)
  ;(() => {
    let x = 1
    for (let i = 0; i < 255; i++) {
      EXP[i] = x
      LOG[x] = i
      x = (x << 1) ^ (x >= 128 ? 0x11d : 0)
    }
    EXP[255] = EXP[0]
  })()

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0
    return EXP[(LOG[a] + LOG[b]) % 255]
  }

  // Reed-Solomon 纠错码
  function rsEncode(data, ecLen) {
    let gen = [1]
    for (let i = 0; i < ecLen; i++) {
      const ng = new Array(gen.length + 1).fill(0)
      const f = EXP[i]
      for (let j = 0; j < gen.length; j++) {
        ng[j] ^= gen[j]
        ng[j + 1] ^= gfMul(gen[j], f)
      }
      gen = ng
    }
    const msg = new Uint8Array(data.length + ecLen)
    msg.set(data)
    for (let i = 0; i < data.length; i++) {
      const c = msg[i]
      if (c) for (let j = 0; j < gen.length; j++) msg[i + j] ^= gfMul(gen[j], c)
    }
    return msg.slice(data.length)
  }

  function pickVersion(len) {
    for (let v = 1; v <= 4; v++) if (len <= CAPACITY[v]) return v
    return 4
  }

  // 编码数据为比特流
  function encodeData(text, ver) {
    const bytes = []
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      if (c < 128) bytes.push(c)
      else if (c < 2048) { bytes.push(192 | (c >> 6)); bytes.push(128 | (c & 63)) }
      else { bytes.push(224 | (c >> 12)); bytes.push(128 | ((c >> 6) & 63)); bytes.push(128 | (c & 63)) }
    }

    const bits = []
    bits.push(0, 1, 0, 0) // 字节模式
    for (let i = 7; i >= 0; i--) bits.push((bytes.length >> i) & 1) // 长度
    for (const b of bytes) for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1)

    const total = DATA_CODEWORDS[ver] * 8
    for (let i = 0; i < Math.min(4, total - bits.length); i++) bits.push(0) // 终止符
    while (bits.length % 8) bits.push(0)

    const cw = []
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0
      for (let j = 0; j < 8; j++) b = (b << 1) | (bits[i + j] || 0)
      cw.push(b)
    }
    const pad = [0xEC, 0x11]
    let pi = 0
    while (cw.length < DATA_CODEWORDS[ver]) cw.push(pad[pi++ % 2])
    return new Uint8Array(cw)
  }

  // 矩阵操作
  function createMatrix(ver) {
    const s = SIZE[ver]
    return Array.from({ length: s }, () => new Array(s).fill(null))
  }

  function placeFinder(m, r, c) {
    const p = [[1,1,1,1,1,1,1],[1,0,0,0,0,0,1],[1,0,1,1,1,0,1],[1,0,1,1,1,0,1],[1,0,1,1,1,0,1],[1,0,0,0,0,0,1],[1,1,1,1,1,1,1]]
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const mr = r + dr, mc = c + dc
        if (mr < 0 || mr >= m.length || mc < 0 || mc >= m.length) continue
        m[mr][mc] = (dr >= 0 && dr < 7 && dc >= 0 && dc < 7) ? p[dr][dc] : 0
      }
    }
  }

  function placeTiming(m) {
    const s = m.length
    for (let i = 8; i < s - 8; i++) {
      const v = i % 2 === 0 ? 1 : 0
      if (m[6][i] === null) m[6][i] = v
      if (m[i][6] === null) m[i][6] = v
    }
  }

  function reserveFormat(m) {
    const s = m.length
    for (let i = 0; i <= 8; i++) {
      if (m[8][i] === null) m[8][i] = 0
      if (m[i][8] === null) m[i][8] = 0
    }
    for (let i = 0; i < 8; i++) { if (m[8][s - 1 - i] === null) m[8][s - 1 - i] = 0 }
    for (let i = 0; i < 7; i++) { if (m[s - 1 - i][8] === null) m[s - 1 - i][8] = 0 }
  }

  function isFunc(r, c, s) {
    if (r < 9 && c < 9) return true
    if (r < 9 && c >= s - 8) return true
    if (r >= s - 8 && c < 9) return true
    if (r === 6 || c === 6) return true
    if (r === 8 && (c < 9 || c >= s - 8)) return true
    if (c === 8 && (r < 9 || r >= s - 7)) return true
    if (r === s - 8 && c === 8) return true
    return false
  }

  function placeData(m, data) {
    const s = m.length
    const bits = []
    for (const b of data) for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1)

    let bi = 0, col = s - 1, up = true
    while (col >= 0) {
      if (col === 6) col--
      const rows = up ? Array.from({ length: s }, (_, i) => s - 1 - i) : Array.from({ length: s }, (_, i) => i)
      for (const row of rows) {
        for (const c of [col, col - 1]) {
          if (c < 0 || m[row][c] !== null) continue
          m[row][c] = bi < bits.length ? bits[bi++] : 0
        }
      }
      col -= 2
      up = !up
    }
  }

  function applyMask(m) {
    const s = m.length
    for (let r = 0; r < s; r++)
      for (let c = 0; c < s; c++)
        if (!isFunc(r, c, s) && (r + c) % 2 === 0) m[r][c] ^= 1
  }

  function getFormatBits() {
    // L=01, mask=0=000 → data=01000
    let rem = 0b01000
    for (let i = 0; i < 10; i++) { rem <<= 1; if (rem & (1 << 10)) rem ^= 0x537 }
    return ((0b01000 << 10) | rem) ^ 0x5412
  }

  function writeFormat(m) {
    const s = m.length
    const fb = getFormatBits()
    const hP = [0,1,2,3,4,5,7,8,s-7,s-6,s-5,s-4,s-3,s-2,s-1]
    const vP = [s-1,s-2,s-3,s-4,s-5,s-6,s-7,8,7,5,4,3,2,1,0]
    for (let i = 0; i < 15; i++) {
      const b = (fb >> (14 - i)) & 1
      if (hP[i] !== undefined) m[8][hP[i]] = b
      if (vP[i] !== undefined) m[vP[i]][8] = b
    }
  }

  // 生成 QR 矩阵
  function generate(text) {
    const ver = pickVersion(text.length)
    const data = encodeData(text, ver)
    const ec = rsEncode(data, EC_CODEWORDS[ver])
    const all = new Uint8Array(data.length + ec.length)
    all.set(data); all.set(ec, data.length)

    const m = createMatrix(ver)
    placeFinder(m, 0, 0)
    placeFinder(m, 0, SIZE[ver] - 7)
    placeFinder(m, SIZE[ver] - 7, 0)
    placeTiming(m)
    m[SIZE[ver] - 8][8] = 1 // 暗模块
    reserveFormat(m)
    placeData(m, all)
    applyMask(m)
    writeFormat(m)
    return { matrix: m, size: SIZE[ver] }
  }

  /**
   * 绘制 QR 码到 Canvas
   * @param {string} canvasId - canvas 组件 id
   * @param {object} ctx - 组件实例（页面传 this）
   * @param {string} text - 编码内容
   * @param {number} canvasSize - canvas 宽高(px)
   */
  function draw(canvasId, ctx, text, canvasSize) {
    canvasSize = canvasSize || 200
    const { matrix, size: qs } = generate(text)
    const quiet = 2
    const total = qs + quiet * 2
    const ms = canvasSize / total

    const c = wx.createCanvasContext(canvasId, ctx)
    c.setFillStyle('#ffffff')
    c.fillRect(0, 0, canvasSize, canvasSize)
    c.setFillStyle('#000000')
    for (let r = 0; r < qs; r++)
      for (let col = 0; col < qs; col++)
        if (matrix[r][col] === 1)
          c.fillRect((col + quiet) * ms, (r + quiet) * ms, ms + 0.5, ms + 0.5)
    c.draw()
  }

  return { generate, draw }
})()

module.exports = QR
