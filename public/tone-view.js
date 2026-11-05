/* Tonal partitions are a separate visualization from defect candidates. */
window.createToneView = function ({ getView, redraw }) {
  const canvas = document.querySelector('#image-canvas');
  const resources = new WeakMap();
  let current = null,
    selected = 0;
  const mode = () => document.querySelector('#preview-mode').value === 'tones';
  const fmt = (v) =>
    v == null
      ? '—'
      : new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(v);
  const unit = (view) =>
    view.unit === 'HU'
      ? 'HU'
      : view.unit === 'estimated-HU'
        ? 'Yaklaşık HU'
        : 'gri ton';
  function resource(view) {
    if (resources.has(view)) return resources.get(view);
    const cache = {
      overlay: null,
      labels: null,
      selection: null,
      selected: null,
    };
    resources.set(view, cache);
    for (const name of ['overlay', 'labelMap']) {
      const image = new Image();
      image.onload = () => {
        if (name === 'overlay') cache.overlay = image;
        else {
          const map = document.createElement('canvas');
          map.width = view.width;
          map.height = view.height;
          const ctx = map.getContext('2d');
          ctx.drawImage(image, 0, 0);
          cache.labels = ctx.getImageData(0, 0, view.width, view.height).data;
        }
        if (getView() === view) redraw();
      };
      image.src = view.toneSegmentation[name];
    }
    return cache;
  }
  function legend(view) {
    document.querySelector('#tone-legend').replaceChildren(
      ...view.toneSegmentation.bands.map((b) => {
        const chip = document.createElement('span');
        const swatch = document.createElement('i');
        swatch.style.background = `rgb(${b.color.join(',')})`;
        chip.append(swatch);
        chip.append(
          `Ton ${b.id}: ${fmt(b.min)}–${fmt(b.max)} ${unit(view)} · %${fmt(b.percent)}`,
        );
        return chip;
      }),
    );
  }
  function sync() {
    const view = getView();
    const show = mode() && !!view?.toneSegmentation;
    document.querySelector('#tone-preview-details').hidden = !show;
    if (current !== view) {
      current = view;
      selected = 0;
      document.querySelector('#tone-region-readout').textContent = '';
      if (show) legend(view);
    } else if (show) legend(view);
  }
  function idAt(cache, i) {
    return (
      cache.labels[i * 4] +
      cache.labels[i * 4 + 1] * 256 +
      cache.labels[i * 4 + 2] * 65536
    );
  }
  function draw(ctx) {
    sync();
    const view = getView();
    if (!mode() || !view?.toneSegmentation) return false;
    const cache = resource(view);
    if (!document.querySelector('#show-candidates').checked) return true;
    if (cache.overlay) ctx.drawImage(cache.overlay, 0, 0);
    if (selected && cache.labels) {
      if (cache.selected !== selected) {
        const layer = document.createElement('canvas');
        layer.width = view.width;
        layer.height = view.height;
        const context = layer.getContext('2d'),
          pixels = context.createImageData(view.width, view.height);
        for (let i = 0; i < view.width * view.height; i++) {
          if (idAt(cache, i) !== selected) continue;
          const x = i % view.width,
            y = Math.floor(i / view.width);
          if (
            x &&
            y &&
            x < view.width - 1 &&
            y < view.height - 1 &&
            [i - 1, i + 1, i - view.width, i + view.width].every(
              (j) => idAt(cache, j) === selected,
            )
          )
            continue;
          pixels.data.set([255, 255, 255, 255], i * 4);
        }
        context.putImageData(pixels, 0, 0);
        cache.selection = layer;
        cache.selected = selected;
      }
      ctx.drawImage(cache.selection, 0, 0);
    }
    return true;
  }
  canvas.addEventListener(
    'click',
    (event) => {
      const view = getView();
      if (
        !mode() ||
        !view?.toneSegmentation ||
        !document.querySelector('#show-candidates').checked
      )
        return;
      const cache = resource(view);
      if (!cache.labels) return;
      const rect = canvas.getBoundingClientRect();
      const x = Math.floor(
          ((event.clientX - rect.left) * view.width) / rect.width,
        ),
        y = Math.floor(
          ((event.clientY - rect.top) * view.height) / rect.height,
        );
      if (x < 0 || y < 0 || x >= view.width || y >= view.height) return;
      event.stopImmediatePropagation();
      selected = idAt(cache, y * view.width + x);
      const r = view.toneSegmentation.regions.find((r) => r.id === selected);
      document.querySelector('#tone-region-readout').textContent = r
        ? `Bölge ${r.id} · Ton ${r.band} · ${r.pixels} piksel · Alan ${fmt(r.area)} mm² · Ortalama ${fmt(r.mean)} ${unit(view)} · Min ${fmt(r.min)} / Maks ${fmt(r.max)}`
        : selected
          ? `Bölge ${selected}: küçük bölge ayrıntısı ilk 200 kayıtta yok; pikselleri ton sınıfı toplamına dahildir.`
          : 'Seçili ölçüm alanının dışında.';
      redraw();
    },
    true,
  );
  function rows(id, values) {
    document.querySelector(id).replaceChildren(
      ...values.map((values) => {
        const row = document.createElement('tr');
        for (const value of values) {
          const cell = document.createElement('td');
          cell.textContent = value;
          row.append(cell);
        }
        return row;
      }),
    );
  }
  function report(result) {
    const tones = result.toneSegmentation;
    document.querySelector('#tone-report').hidden = !tones;
    if (!tones) return;
    document.querySelector('#tone-summary').textContent =
      `${tones.bands.length} ton sınıfı · ${tones.count} bağlı bölge · ${tones.pixels} pikselin tamamı bölgelendi.`;
    document.querySelector('#tone-truncation').textContent = tones.truncated
      ? 'En büyük 200 bağlı bölge listeleniyor; ton sınıfı toplamları tüm geçerli pikselleri kapsar.'
      : 'Bütün bağlı bölgeler listeleniyor.';
    rows(
      '#tone-bands',
      tones.bands.map((b) => [
        `Ton ${b.id}`,
        `${fmt(b.lower)}–${fmt(b.upper)} ${unit(result)}`,
        b.pixels,
        fmt(b.area),
        fmt(b.percent),
        fmt(b.mean),
        fmt(b.std),
      ]),
    );
    rows(
      '#tone-regions',
      tones.regions.map((r) => [
        r.id,
        r.band,
        r.pixels,
        fmt(r.area),
        fmt(r.mean),
        fmt(r.min),
        fmt(r.max),
      ]),
    );
  }
  return { draw, sync, report };
};
