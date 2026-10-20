"""Play tuning sessions through the real app in Chromium, at real-time speed,
with the CPU throttled to phone level, and log what the screen shows every frame.

usage: python3 play.py <session> [<session> ...] [--video] [--cpu N]
"""
import json, sys, time, os
from playwright.sync_api import sync_playwright

import os
BASE = os.path.dirname(os.path.abspath(__file__))
URL = os.environ.get('UXTEST_URL', 'http://localhost:8766/')

PLAY_JS = r"""
async ({ name, instrument }) => {
  const buf = await (await fetch(`sessions/${name}.wav`)).arrayBuffer();
  const dv = new DataView(buf);
  let off = 12, dataOff = 0, dataLen = 0;
  while (off < buf.byteLength) {
    const id = String.fromCharCode(dv.getUint8(off), dv.getUint8(off + 1), dv.getUint8(off + 2), dv.getUint8(off + 3));
    const size = dv.getUint32(off + 4, true);
    if (id === 'data') { dataOff = off + 8; dataLen = size; break; }
    off += 8 + size;
  }
  const pcm = new Int16Array(buf, dataOff, dataLen / 2);
  const x = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) x[i] = pcm[i] / 32768;

  document.querySelector(`.view-btn[data-view="${instrument}"]`).click();
  await new Promise((r) => setTimeout(r, 300));
  window.__tuner.start(48000);
  const SR = 48000, BLOCK = 1024;
  const $ = (id) => document.getElementById(id);
  const scale = $('scale');
  const log = [];
  let fed = 0;
  const t0 = performance.now();
  window.__t0wall = Date.now();
  const feed = () => {
    const due = Math.floor(((performance.now() - t0) / 1000) * SR);
    while (fed + BLOCK <= due && fed + BLOCK <= x.length) {
      window.__tuner.feed(x.subarray(fed, fed + BLOCK));
      fed += BLOCK;
    }
  };
  const timer = setInterval(feed, 5);
  return await new Promise((resolve) => {
    const frame = (now) => {
      feed();
      const st = $('stage').dataset;
      const tr = $('needle').style.transform;
      const px = tr ? parseFloat(tr.slice(11)) : 0;
      const target = document.querySelector('.peg.is-target');
      const tuned = [...document.querySelectorAll('.peg.is-tuned')].map((e) => e.getAttribute('aria-label'));
      log.push([
        +(fed / SR).toFixed(4), +((now - t0) / 1000).toFixed(4), st.state, st.held === 'true', st.tune === 'in',
        $('note-letter').textContent + $('note-acc').textContent + $('note-oct').textContent,
        $('direction').textContent, $('detail-cents').textContent,
        +((px / scale.clientWidth) * 100).toFixed(2),
        target ? target.getAttribute('aria-label') : null, tuned.join(','),
      ]);
      if (fed + BLOCK > x.length) { clearInterval(timer); resolve(log); }
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}
"""

def main():
    args = sys.argv[1:]
    video = '--video' in args
    cpu = 4
    if '--cpu' in args: cpu = int(args[args.index('--cpu') + 1])
    names = [a for a in args if not a.startswith('--') and not a.isdigit()]
    os.makedirs(f'{BASE}/logs', exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        for name in names:
            meta = json.load(open(f'{BASE}/www/sessions/{name}.json'))
            opts = dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, color_scheme='dark')
            if video:
                opts['record_video_dir'] = f'{BASE}/video'
                opts['record_video_size'] = {'width': 390, 'height': 844}
            ctx = browser.new_context(**opts)
            t_ctx = time.time()
            page = ctx.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            cdp = ctx.new_cdp_session(page)
            cdp.send('Emulation.setCPUThrottlingRate', {'rate': cpu})
            page.goto(URL)
            page.wait_for_timeout(800)
            t_play = time.time()
            log = page.evaluate(PLAY_JS, {'name': name, 'instrument': meta['instrument']})
            t0wall = page.evaluate('window.__t0wall') / 1000
            vid = page.video.path() if video else None
            ctx.close()
            out = {'session': name, 'cpu': cpu, 'frames': log, 'errors': errors,
                   'video': vid, 'video_offset': t0wall - t_ctx}
            json.dump(out, open(f'{BASE}/logs/{name}.json', 'w'))
            fps = len(log) / max(1e-6, log[-1][1])
            print(f'{name}: {len(log)} frames, {fps:.0f} fps, errors={errors}, video={vid}')
        browser.close()

main()
