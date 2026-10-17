import {
  defaultWindowSize, computeWindowPlan, parseSavedWindowState, isRectVisible,
  WINDOW_MIN_WIDTH, WINDOW_MIN_HEIGHT
} from '../../canvas/windowBounds';
import {
  clampCentreIntoRect, clampCandidateToStage, calloutFitLabel, twoPassFit, extendBoundsByLabels,
  isCompactToolbar, noticeSummary, type CalloutSpec
} from '../../canvas/polishN4';
import { layoutLabels, type LabelRequest } from '../../canvas/labelLayout';
import { fitBounds, FIT_PADDING } from '../../canvas/drawingGeometry';

function assert(c: boolean, m: string): void {
  if (!c) throw new Error(m);
}

console.log('=== Running Viewport Polish (N4) Test ===');

// 1. Window bounds
{
  const wa = { x: 0, y: 0, width: 1920, height: 1040 };
  const d = defaultWindowSize(wa);
  assert(d.width === 1728 && d.height === 936, `90% of work area: ${d.width}x${d.height}`);
  const small = defaultWindowSize({ width: 1366, height: 728 });
  assert(small.width === 1280 && small.height === 728, `min 1280x800 but never beyond the work area: ${small.width}x${small.height}`);
  assert(defaultWindowSize({ width: 3840, height: 2100 }).width === 3456, '4K = 90%');

  const first = computeWindowPlan(wa, null);
  assert(first.maximize === true, 'first run opens maximized');
  assert(first.width === 1728 && first.x === 96, 'first run centred at the default size');

  const restored = computeWindowPlan(wa, { x: 100, y: 50, width: 1400, height: 900, maximized: false });
  assert(!restored.maximize && restored.x === 100 && restored.y === 50 && restored.width === 1400 && restored.height === 900, 'restores last bounds');
  assert(computeWindowPlan(wa, { x: 100, y: 50, width: 1400, height: 900, maximized: true }).maximize, 'restores maximized');

  const tiny = computeWindowPlan(wa, { x: 0, y: 0, width: 300, height: 300, maximized: false });
  assert(tiny.width === WINDOW_MIN_WIDTH && tiny.height === WINDOW_MIN_HEIGHT, 'saved size is clamped to the 1100x700 minimum');
  assert(WINDOW_MIN_WIDTH === 1100 && WINDOW_MIN_HEIGHT === 700, 'minimum window 1100x700');

  const off = computeWindowPlan(wa, { x: 5000, y: 4000, width: 1400, height: 900, maximized: false });
  assert(off.x === 260 && off.y === 70, `off-screen position is re-centred: ${off.x},${off.y}`);
  assert(isRectVisible({ x: 1800, y: 0, width: 1400, height: 900 }, [wa], 120), 'partly visible counts');
  assert(!isRectVisible({ x: 1900, y: 0, width: 1400, height: 900 }, [wa], 120), 'barely visible does not');

  assert(parseSavedWindowState('not json') === null, 'bad JSON -> null');
  assert(parseSavedWindowState('{"width":10,"height":10}') === null, 'absurd size -> null');
  assert(parseSavedWindowState(null) === null && parseSavedWindowState('') === null, 'empty -> null');
  const ok = parseSavedWindowState('{"x":10,"y":20,"width":1500,"height":950,"maximized":true}');
  assert(!!ok && ok.x === 10 && ok.maximized === true, 'valid JSON parsed');
  const nopos = parseSavedWindowState('{"width":1500,"height":950}');
  assert(!!nopos && nopos.x === undefined && nopos.maximized === false, 'missing position / flag');
}

// 2. Callout clamp keeps boxes inside the stage
{
  const stage = { x: 0, y: 0, w: 800, h: 500 };
  const left = clampCentreIntoRect(-20, 250, 140, 90, stage, 6);
  assert(left.moved && left.x === 76 && left.y === 250, `clamped from the left edge: ${left.x}`);
  const br = clampCentreIntoRect(900, 600, 140, 90, stage, 6);
  assert(br.x === 724 && br.y === 449, `clamped bottom-right: ${br.x},${br.y}`);
  const inside = clampCentreIntoRect(400, 250, 140, 90, stage, 6);
  assert(!inside.moved && inside.x === 400, 'inside stays put');
  const huge = clampCentreIntoRect(400, 250, 2000, 90, stage, 6);
  assert(huge.x - 1000 === 6, 'oversized box is aligned to the left edge');
  const c = clampCandidateToStage({ x: -30, y: 100, angleDeg: 0 }, { w: 140, h: 90 }, stage, 6);
  assert(c.leader === true && c.x === 76, 'moved candidates get a leader');
  assert(clampCandidateToStage({ x: 300, y: 100 }, { w: 140, h: 90 }, stage, 6).leader === undefined, 'unmoved ones do not');

  // through the layout: a callout whose natural spot is off the stage ends inside it, with a leader
  const req: LabelRequest = {
    id: 'c:z1', lines: ['PACKAGED UNIT', '8,908 Btu/h EACH', '260 CFM EACH'], fontPx: 10, priority: 5, mandatory: true, guaranteed: true,
    keepInside: true, anchor: { x: 10, y: 200 }, candidates: [{ x: -60, y: 200 }, { x: -200, y: 200 }]
  };
  const out = layoutLabels([req], [], { stage, stageMargin: 6 }).get('c:z1');
  assert(!!out && out.visible && out.rect.x >= 6 - 1e-6 && out.rect.x + out.rect.w <= 794 + 1e-6, 'callout rect inside stage');
  assert(!!out && out.leader, 'moved callout keeps a leader to its symbol');
  const free = layoutLabels([{ ...req, keepInside: false }], [], { stage }).get('c:z1');
  assert(!!free && free.rect.x < 0, 'without keepInside the box stays clipped (control)');
}

// 3. Two-pass Fit All reserves room for callouts
{
  const content = { minX: 0, minY: 0, maxX: 1200, maxY: 800 };
  const room = [100, 100, 500, 100, 500, 400, 100, 400];
  // a callout box (240x150 screen px) that cannot fit the 400x300 room at this scale -> sits outside, left of the content
  const spec: CalloutSpec = { anchor: { x: 100, y: 120 }, poly: room, size: { w: 240, h: 150 } };
  const view = { w: 1400, h: 900 };
  const pad = { top: FIT_PADDING.top + 100, right: FIT_PADDING.right + 60, bottom: FIT_PADDING.bottom + 60, left: FIT_PADDING.left + 60 };
  const labelsAt = (sc: number): ReturnType<typeof calloutFitLabel>[] => [calloutFitLabel(spec, content, sc)];
  const nonNull = (sc: number): NonNullable<ReturnType<typeof calloutFitLabel>>[] => labelsAt(sc).filter((l): l is NonNullable<typeof l> => l !== null);
  const f = twoPassFit(content, nonNull, view.w, view.h, 0.92, pad);
  const plain = fitBounds(content, view.w, view.h, 0.92, pad);
  assert(f.scale <= plain.scale + 1e-9, 'reserving callouts never zooms in');
  const labels = nonNull(f.scale);
  // every callout box, converted at the final scale, lies inside the view
  for (const l of labels) {
    const sx = f.x + (l.ax * f.scale + l.dx), sy = f.y + (l.ay * f.scale + l.dy);
    assert(sx - l.w / 2 >= -1 && sx + l.w / 2 <= view.w + 1, `callout x inside the view: ${sx - l.w / 2}..${sx + l.w / 2}`);
    assert(sy - l.h / 2 >= -1 && sy + l.h / 2 <= view.h + 1, `callout y inside the view: ${sy - l.h / 2}..${sy + l.h / 2}`);
  }
  // independent of any previous view: same inputs -> same output
  const g = twoPassFit(content, nonNull, view.w, view.h, 0.92, pad);
  assert(g.scale === f.scale && g.x === f.x && g.y === f.y, 'deterministic, no feedback');
  // a callout that fits inside its room adds nothing
  const tiny: CalloutSpec = { anchor: { x: 120, y: 120 }, poly: room, size: { w: 60, h: 30 } };
  assert(calloutFitLabel(tiny, content, 0.5) === null, 'inside-the-room callout needs no padding');
  const b = extendBoundsByLabels(content, [{ ax: 0, ay: 0, dx: -100, dy: 0, w: 100, h: 50 }], 0.5);
  assert(b.minX === -300 && b.maxX === 1200, 'screen px converted by the scale (150 px / 0.5)');
  // at most two refits: the label function is called twice
  let calls = 0;
  twoPassFit(content, (sc) => { calls++; return nonNull(sc); }, view.w, view.h, 0.92, pad);
  assert(calls === 2, `exactly two passes, got ${calls}`);
}

// 4. Compact toolbar / collapsed notice
{
  assert(isCompactToolbar(1199) && isCompactToolbar(780) && !isCompactToolbar(1200) && !isCompactToolbar(1600), 'compact below 1200 px');
  const names = ['Concealed Ducted Split', 'High Wall DX Split', 'Packaged Rooftop Unit', 'Cassette Split System'];
  assert(noticeSummary('No drain point', names, false) === 'No drain point: Concealed Ducted Split (+3 zones)', 'collapsed line');
  assert(noticeSummary('No drain point', names.slice(0, 2), false).endsWith('(+1 zone)'), 'singular');
  assert(noticeSummary('No drain point', names.slice(0, 1), false) === 'No drain point: Concealed Ducted Split', 'one zone: no suffix');
  assert(noticeSummary('X', names, true) === `X: ${names.join(', ')}`, 'expanded lists every zone');
}

console.log('Viewport Polish (N4) OK');
