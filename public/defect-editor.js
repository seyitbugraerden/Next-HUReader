/* Editable candidate contours. Original masks stay exact until a contour is changed. */
window.createDefectEditor = function ({
  getReview,
  hasFile,
  isBusy,
  onChange,
  redraw,
  onError,
}) {
  const canvas = document.querySelector('#image-canvas');
  const svg = document.querySelector('#defect-editor-overlay');
  const toggle = document.querySelector('#edit-defects');
  const show = document.querySelector('#show-candidates');
  const resources = new WeakMap();
  let drag = null;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const active = () => !!getReview() && toggle.checked && show.checked;
  const editsFor = (review) =>
    new Map(review.edits.map((edit) => [edit.id, edit.points]));
  function pointsFor(review, region) {
    const edit = review.edits.find((edit) => edit.id === region.id);
    return edit ? edit.points : region.outline;
  }
  function change(review, id, points) {
    review.edits = review.edits.filter((edit) => edit.id !== id);
    review.edits.push({ id, points });
  }
  function remember(review) {
    review.history.push(clone(review.edits));
    if (review.history.length > 40) review.history.shift();
  }
  function sync() {
    const review = getReview();
    document.querySelector('#defect-edit-tools').hidden = !review;
    const activation = document.querySelector('#preview-defects');
    document.querySelector('.preview-analysis-action').hidden = !hasFile();
    activation.disabled = isBusy() || !hasFile();
    activation.textContent =
      activation.getAttribute('aria-busy') === 'true'
        ? 'Analiz ediliyor…'
        : review
          ? 'Yeniden analiz et (sıfırla)'
          : 'Analiz et';
    document.querySelector('#undo-defect').disabled =
      isBusy() || !review?.history.length;
    document.querySelector('#reset-defects').disabled =
      isBusy() || !review?.edits.length;
    toggle.disabled = isBusy();
    document.querySelector('#defect-edit-status').textContent = review
      ? `${review.base.defects.count} aday tespit edildi · ${review.edits.length} aday düzenlendi.${review.base.defects.truncated ? ' En büyük 50 aday düzenlenebilir; diğer adaylar korunur.' : ''}${review.base.defects.regions.some((region) => region.outlineApproximate) ? ' Karmaşık sınırlar kutu taslağıyla gösterilir; düzenlenene kadar özgün piksel maskeleri korunur.' : ''}`
      : '';
    svg.toggleAttribute('hidden', !active());
    if (!active()) svg.replaceChildren();
  }
  function element(name, attributes, text) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attributes))
      node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function locate() {
    const rect = canvas.getBoundingClientRect(),
      parent = svg.parentElement.getBoundingClientRect();
    const scale = Math.min(
      rect.width / canvas.width,
      rect.height / canvas.height,
    );
    const width = canvas.width * scale,
      height = canvas.height * scale;
    svg.style.left = `${rect.left - parent.left + (rect.width - width) / 2}px`;
    svg.style.top = `${rect.top - parent.top + (rect.height - height) / 2}px`;
    svg.style.width = `${width}px`;
    svg.style.height = `${height}px`;
    svg.setAttribute('viewBox', `0 0 ${canvas.width} ${canvas.height}`);
    return scale || 1;
  }
  function handleGeometry(ctx, review) {
    svg.replaceChildren();
    if (!active()) return;
    const scale = locate();
    const regions = review.base.defects.regions;
    for (const region of regions) {
      const points = pointsFor(review, region);
      if (!points?.length) continue;
      const selected = review.selected === region.id;
      const path = element('polygon', {
        points: points.map((p) => p.join(',')).join(' '),
        class: `defect-edit-polygon${selected ? ' selected' : ''}`,
        'data-region': region.id,
        tabindex: '0',
        role: 'button',
        'aria-label': `Boşluk ${region.id} sınırını seç`,
        'vector-effect': 'non-scaling-stroke',
      });
      svg.append(path);
    }
    // Put the selected region's controls last so other polygons cannot cover them.
    for (const region of regions) {
      const points = pointsFor(review, region);
      if (!points?.length) continue;
      if (review.selected === region.id)
        points.forEach(([x, y], index) => {
          svg.append(
            element('circle', {
              cx: x,
              cy: y,
              r: 5 / scale,
              class: `defect-edit-point${review.vertex === index ? ' selected' : ''}`,
              'data-region': region.id,
              'data-vertex': index,
              tabindex: '0',
              role: 'button',
              'aria-label': `Boşluk ${region.id} nokta ${index + 1}`,
              'vector-effect': 'non-scaling-stroke',
            }),
          );
        });
      const x = Math.max(
        12 / scale,
        Math.min(
          canvas.width - 12 / scale,
          Math.max(...points.map((p) => p[0])),
        ),
      );
      const y = Math.max(
        12 / scale,
        Math.min(
          canvas.height - 12 / scale,
          Math.min(...points.map((p) => p[1])) - 13 / scale,
        ),
      );
      const button = element('g', {
        class: 'defect-remove',
        'data-remove': region.id,
        tabindex: '0',
        role: 'button',
        'aria-label': `Boşluk ${region.id} kaldır`,
      });
      button.append(element('circle', { cx: x, cy: y, r: 11 / scale }));
      button.append(
        element(
          'text',
          {
            x,
            y,
            'font-size': 18 / scale,
            'text-anchor': 'middle',
            'dominant-baseline': 'central',
          },
          '×',
        ),
      );
      svg.append(button);
    }
  }
  function draw(ctx) {
    const review = getReview();
    sync();
    if (!review) return false;
    let cache = resources.get(review);
    if (!cache) {
      cache = { layer: document.createElement('canvas'), pixels: null };
      resources.set(review, cache);
      const labels = new Image();
      labels.onload = () => {
        cache.layer.width = review.base.width;
        cache.layer.height = review.base.height;
        const context = cache.layer.getContext('2d');
        context.drawImage(labels, 0, 0);
        cache.pixels = context.getImageData(
          0,
          0,
          labels.width,
          labels.height,
        ).data;
        if (getReview() === review) redraw();
      };
      labels.src = review.base.defects.labelMap;
    }
    if (show.checked && cache.pixels) {
      const edited = editsFor(review);
      const key = [...edited.keys()].sort((a, b) => a - b).join(',');
      if (cache.key !== key) {
        const context = cache.layer.getContext('2d');
        const image = context.createImageData(
          review.base.width,
          review.base.height,
        );
        for (let offset = 0; offset < cache.pixels.length; offset += 4) {
          const id =
            cache.pixels[offset] +
            cache.pixels[offset + 1] * 256 +
            cache.pixels[offset + 2] * 65536;
          if (!id || edited.has(id)) continue;
          image.data[offset] = 255;
          image.data[offset + 1] = 50;
          image.data[offset + 2] = 200;
          image.data[offset + 3] = 150;
        }
        context.putImageData(image, 0, 0);
        cache.key = key;
      }
      ctx.drawImage(cache.layer, 0, 0);
      ctx.fillStyle = 'rgba(255,50,200,.4)';
      for (const points of edited.values()) {
        if (!points) continue;
        ctx.beginPath();
        ctx.moveTo(...points[0]);
        for (const p of points.slice(1)) ctx.lineTo(...p);
        ctx.closePath();
        ctx.fill();
      }
    }
    handleGeometry(ctx, review);
    return true;
  }
  function point(event) {
    const rect = svg.getBoundingClientRect();
    return [
      Math.max(
        0,
        Math.min(
          canvas.width,
          ((event.clientX - rect.left) * canvas.width) / rect.width,
        ),
      ),
      Math.max(
        0,
        Math.min(
          canvas.height,
          ((event.clientY - rect.top) * canvas.height) / rect.height,
        ),
      ),
    ].map((value) => Math.round(value * 10) / 10);
  }
  function nearestEdge(points, p) {
    let best = { index: 0, distance: Infinity };
    points.forEach((a, index) => {
      const b = points[(index + 1) % points.length],
        dx = b[0] - a[0],
        dy = b[1] - a[1];
      const t = Math.max(
        0,
        Math.min(
          1,
          ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1),
        ),
      );
      const distance = Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
      if (distance < best.distance) best = { index, distance };
    });
    return best;
  }
  function valid(points) {
    const cross = (a, b, c) =>
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const on = (a, b, c) =>
      Math.abs(cross(a, b, c)) < 1e-8 &&
      c[0] >= Math.min(a[0], b[0]) &&
      c[0] <= Math.max(a[0], b[0]) &&
      c[1] >= Math.min(a[1], b[1]) &&
      c[1] <= Math.max(a[1], b[1]);
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        b = points[(i + 1) % points.length];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-8) return false;
      area += a[0] * b[1] - b[0] * a[1];
      for (let j = i + 1; j < points.length; j++) {
        if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
        const c = points[j],
          d = points[(j + 1) % points.length];
        if (
          (cross(a, b, c) * cross(a, b, d) < 0 &&
            cross(c, d, a) * cross(c, d, b) < 0) ||
          on(a, b, c) ||
          on(a, b, d) ||
          on(c, d, a) ||
          on(c, d, b)
        )
          return false;
      }
    }
    return points.length >= 3 && Math.abs(area) > 1e-6;
  }
  function commit(review, before) {
    if (JSON.stringify(before) === JSON.stringify(review.edits)) return;
    review.history.push(before);
    if (review.history.length > 40) review.history.shift();
    onChange();
  }
  function remove(id) {
    const review = getReview();
    if (!review || isBusy()) return;
    remember(review);
    change(review, id, null);
    review.selected = null;
    review.vertex = null;
    onChange();
    redraw();
  }
  svg.addEventListener('pointerdown', (event) => {
    if (!active() || isBusy() || event.button !== 0) return;
    event.preventDefault();
    const removeButton = event.target.closest('[data-remove]');
    if (removeButton) {
      remove(Number(removeButton.dataset.remove));
      return;
    }
    const target = event.target.closest('[data-region]');
    if (!target) return;
    const review = getReview(),
      id = Number(target.dataset.region);
    const region = review.base.defects.regions.find((r) => r.id === id);
    const points = clone(pointsFor(review, region));
    if (!points.length) return;
    const before = clone(review.edits);
    let vertex =
      target.dataset.vertex === undefined
        ? null
        : Number(target.dataset.vertex);
    // At low zoom neighboring handle strokes can overlap. Choose the closest
    // vertex center rather than whichever circle happens to be painted last.
    if (vertex !== null) {
      const hit = point(event);
      vertex = points.reduce(
        (nearest, p, index) =>
          Math.hypot(p[0] - hit[0], p[1] - hit[1]) <
          Math.hypot(points[nearest][0] - hit[0], points[nearest][1] - hit[1])
            ? index
            : nearest,
        vertex,
      );
    }
    if (vertex === null && review.selected === id) {
      const edge = nearestEdge(points, point(event));
      const rect = svg.getBoundingClientRect();
      if ((edge.distance * rect.width) / canvas.width <= 12) {
        if (points.length >= 512) {
          onError('En fazla 512 sınır noktası kullanılabilir.');
          return;
        }
        vertex = edge.index + 1;
        points.splice(vertex, 0, point(event));
      }
    }
    review.selected = id;
    review.vertex = vertex;
    if (vertex !== null) {
      change(review, id, points);
      drag = { review, id, vertex, before, pointerId: event.pointerId };
      svg.setPointerCapture(event.pointerId);
    }
    redraw();
  });
  svg.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId || isBusy()) return;
    const edit = drag.review.edits.find((edit) => edit.id === drag.id);
    edit.points[drag.vertex] = point(event);
    redraw();
  });
  function finish(cancel = false) {
    if (!drag) return;
    const current = drag;
    drag = null;
    try {
      svg.releasePointerCapture(current.pointerId);
    } catch {}
    const points = current.review.edits.find(
      (edit) => edit.id === current.id,
    ).points;
    if (cancel || !valid(points)) {
      current.review.edits = current.before;
      if (!cancel)
        onError(
          'Sınır kendi üzerinden geçemez veya sıfır alanlı olamaz. Son hareket geri alındı.',
        );
    } else commit(current.review, current.before);
    redraw();
  }
  svg.addEventListener('pointerup', () => finish());
  svg.addEventListener('pointercancel', () => finish(true));
  // A click in editing mode must not start a sample ROI selection underneath.
  for (const name of ['pointerdown', 'pointermove', 'pointerup', 'click'])
    canvas.addEventListener(
      name,
      (event) => {
        if (active()) event.stopImmediatePropagation();
      },
      true,
    );
  svg.addEventListener('keydown', (event) => {
    if (isBusy()) return;
    const removeButton = event.target.closest('[data-remove]');
    if (removeButton && ['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      remove(Number(removeButton.dataset.remove));
      return;
    }
    const target = event.target.closest('[data-region]');
    if (!target) return;
    const review = getReview(),
      id = Number(target.dataset.region);
    review.selected = id;
    if (target.dataset.vertex !== undefined)
      review.vertex = Number(target.dataset.vertex);
    if (['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      redraw();
    }
    if (
      ['Delete', 'Backspace'].includes(event.key) &&
      target.dataset.vertex !== undefined
    ) {
      event.preventDefault();
      const region = review.base.defects.regions.find((r) => r.id === id),
        points = clone(pointsFor(review, region));
      if (points.length <= 3) {
        onError('Sınır en az üç noktadan oluşmalıdır.');
        return;
      }
      points.splice(review.vertex, 1);
      if (!valid(points)) {
        onError('Nokta silme sınırın kendi üzerinden geçmesine neden oluyor.');
        return;
      }
      remember(review);
      change(review, id, points);
      review.vertex = null;
      onChange();
      redraw();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && drag) {
      event.preventDefault();
      finish(true);
    }
  });
  document.querySelector('#undo-defect').addEventListener('click', () => {
    const review = getReview();
    if (!review?.history.length || isBusy()) return;
    review.edits = review.history.pop();
    review.vertex = null;
    onChange();
    redraw();
  });
  document.querySelector('#reset-defects').addEventListener('click', () => {
    const review = getReview();
    if (!review?.edits.length || isBusy()) return;
    remember(review);
    review.edits = [];
    review.vertex = null;
    onChange();
    redraw();
  });
  toggle.addEventListener('change', () => {
    finish(true);
    redraw();
  });
  new ResizeObserver(() => {
    if (active()) locate();
  }).observe(canvas);
  return {
    draw,
    sync,
    cancel: () => finish(true),
    get dragging() {
      return !!drag;
    },
  };
};
