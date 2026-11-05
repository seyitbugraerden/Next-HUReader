/* Display-only zoom. Canvas and SVG retain their original image coordinates. */
window.createPreviewViewport = function ({ redraw, canZoom = () => true }) {
  const viewer = document.querySelector('#viewer');
  const surface = document.querySelector('#preview-surface');
  const canvas = document.querySelector('#image-canvas');
  const level = document.querySelector('#zoom-level');
  const panButton = document.querySelector('#preview-pan');
  let panning = false;
  let pan = null;
  const padding = () => {
    const style = getComputedStyle(viewer);
    return {
      x: parseFloat(style.paddingLeft),
      y: parseFloat(style.paddingTop),
    };
  };
  let zoom = 1;
  let fitScale = 1;
  let image = null;
  const maxZoom = 32;
  function controls() {
    level.value = `${Math.round(zoom * 100)}%`;
    document.querySelector('#zoom-in').disabled = !image || zoom >= maxZoom;
    document.querySelector('#zoom-out').disabled = !image || zoom <= 1;
    document.querySelector('#zoom-fit').disabled = !image;
    panButton.disabled = !image;
    panButton.setAttribute('aria-pressed', String(panning));
    viewer.classList.toggle('is-panning', panning);
  }
  function layout() {
    if (!image) return;
    const inset = padding();
    const height = document.fullscreenElement
      ? Math.max(200, innerHeight - 260)
      : 520;
    fitScale = Math.min(
      1,
      Math.max(1, viewer.clientWidth - inset.x * 2) / image.width,
      height / image.height,
    );
    const width = image.width * fitScale * zoom;
    const imageHeight = image.height * fitScale * zoom;
    surface.style.width = `${width}px`;
    surface.style.height = `${imageHeight}px`;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${imageHeight}px`;
    viewer.style.height = `${Math.max(342, Math.min(height, image.height * fitScale)) + inset.y * 2}px`;
    controls();
  }
  function center() {
    const rect = canvas.getBoundingClientRect();
    const bounds = viewer.getBoundingClientRect();
    return [
      rect.width <= viewer.clientWidth
        ? image.width / 2
        : (bounds.left + viewer.clientWidth / 2 - rect.left) /
          (fitScale * zoom),
      rect.height <= viewer.clientHeight
        ? image.height / 2
        : (bounds.top + viewer.clientHeight / 2 - rect.top) / (fitScale * zoom),
    ];
  }
  function setZoom(value, point = center(), anchor = null) {
    if (!image || !canZoom() || pan) return;
    zoom = Math.max(1, Math.min(maxZoom, value));
    layout();
    const bounds = viewer.getBoundingClientRect();
    const rect = canvas.getBoundingClientRect();
    const target = anchor || [viewer.clientWidth / 2, viewer.clientHeight / 2];
    viewer.scrollLeft +=
      rect.left +
      point[0] * fitScale * zoom -
      (bounds.left + viewer.clientLeft + target[0]);
    viewer.scrollTop +=
      rect.top +
      point[1] * fitScale * zoom -
      (bounds.top + viewer.clientTop + target[1]);
    redraw();
  }
  document
    .querySelector('#zoom-in')
    .addEventListener('click', () => setZoom(zoom * 2));
  document
    .querySelector('#zoom-out')
    .addEventListener('click', () => setZoom(zoom / 2));
  document
    .querySelector('#zoom-fit')
    .addEventListener('click', () => setZoom(1));
  let gesture = null;
  function zoomAnchor(event) {
    const rect = canvas.getBoundingClientRect();
    const bounds = viewer.getBoundingClientRect();
    const x = Number.isFinite(event.clientX)
      ? event.clientX
      : bounds.left + viewer.clientWidth / 2;
    const y = Number.isFinite(event.clientY)
      ? event.clientY
      : bounds.top + viewer.clientHeight / 2;
    return {
      point: [
        Math.max(0, Math.min(image.width, (x - rect.left) / (fitScale * zoom))),
        Math.max(0, Math.min(image.height, (y - rect.top) / (fitScale * zoom))),
      ],
      anchor: [
        x - bounds.left - viewer.clientLeft,
        y - bounds.top - viewer.clientTop,
      ],
    };
  }
  // Trackpad pinch arrives as Ctrl+wheel in Chromium/Firefox. Plain wheel
  // events keep their native scrolling behavior, including two-finger panning.
  viewer.addEventListener(
    'wheel',
    (event) => {
      if (!image || !event.ctrlKey) return;
      event.preventDefault();
      if (gesture || !canZoom() || pan) return;
      const { point, anchor } = zoomAnchor(event);
      const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? viewer.clientHeight
            : 1;
      const delta = Math.max(-200, Math.min(200, event.deltaY * unit));
      setZoom(zoom * Math.exp(-delta * 0.01), point, anchor);
    },
    { passive: false },
  );
  // Safari exposes native trackpad pinch through gesture events instead.
  viewer.addEventListener(
    'gesturestart',
    (event) => {
      if (!image) return;
      event.preventDefault();
      if (!canZoom() || pan) return;
      gesture = { zoom, ...zoomAnchor(event) };
    },
    { passive: false },
  );
  viewer.addEventListener(
    'gesturechange',
    (event) => {
      if (!image) return;
      event.preventDefault();
      if (!gesture || !Number.isFinite(event.scale) || event.scale <= 0) return;
      setZoom(gesture.zoom * event.scale, gesture.point, gesture.anchor);
    },
    { passive: false },
  );
  viewer.addEventListener(
    'gestureend',
    (event) => {
      if (!gesture) return;
      event.preventDefault();
      gesture = null;
    },
    { passive: false },
  );
  panButton.addEventListener('click', () => {
    panning = !panning;
    controls();
  });
  viewer.addEventListener(
    'pointerdown',
    (event) => {
      if (!panning || !image || event.button !== 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      pan = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: viewer.scrollLeft,
        top: viewer.scrollTop,
      };
      viewer.setPointerCapture(event.pointerId);
    },
    true,
  );
  viewer.addEventListener(
    'pointermove',
    (event) => {
      if (!pan || pan.id !== event.pointerId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      viewer.scrollLeft = pan.left - event.clientX + pan.x;
      viewer.scrollTop = pan.top - event.clientY + pan.y;
    },
    true,
  );
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    viewer.addEventListener(
      name,
      (event) => {
        if (!pan || pan.id !== event.pointerId) return;
        event.stopImmediatePropagation();
        pan = null;
        if (viewer.hasPointerCapture(event.pointerId))
          viewer.releasePointerCapture(event.pointerId);
      },
      true,
    );
  }
  viewer.addEventListener(
    'click',
    (event) => {
      if (panning) event.stopImmediatePropagation();
    },
    true,
  );
  new ResizeObserver(() => {
    if (!image || !viewer.clientWidth) return;
    layout();
    redraw();
  }).observe(viewer);
  controls();
  return {
    setImage(next) {
      if (image?.width !== next.width || image?.height !== next.height)
        zoom = 1;
      image = next;
      surface.hidden = false;
      layout();
    },
    reset() {
      image = null;
      zoom = 1;
      panning = false;
      pan = null;
      gesture = null;
      surface.hidden = true;
      viewer.style.height = '';
      viewer.scrollLeft = viewer.scrollTop = 0;
      controls();
    },
    get zoom() {
      return zoom;
    },
  };
};
