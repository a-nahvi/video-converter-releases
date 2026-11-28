"use strict";

function enhanceSelects(selects) {
  let openSelect = null;
  const controls = new Map();

  function closeOpenSelect() {
    openSelect?.close();
  }

  document.addEventListener("pointerdown", (event) => {
    if (openSelect && !openSelect.root.contains(event.target)) closeOpenSelect();
  });
  window.addEventListener("resize", closeOpenSelect);

  function icon(name) {
    const span = document.createElement("span");
    span.className = `icon icon-${name}`;
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  for (const select of selects) {
    const label = select.labels[0];
    const root = document.createElement("div");
    root.className = "custom-select";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "select-trigger";
    trigger.id = `${select.id}-trigger`;
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    const description = select.getAttribute("aria-describedby");
    if (description) trigger.setAttribute("aria-describedby", description);

    const value = document.createElement("bdi");
    value.className = "select-value";
    value.id = `${select.id}-value`;
    if (select.dataset.icon) trigger.append(icon(select.dataset.icon));
    trigger.append(value, icon("chevron"));

    const list = document.createElement("ul");
    list.id = `${select.id}-options`;
    list.className = "select-list";
    list.setAttribute("role", "listbox");
    list.hidden = true;
    trigger.setAttribute("aria-controls", list.id);
    label.id ||= `${select.id}-label`;
    label.htmlFor = trigger.id;
    trigger.setAttribute("aria-labelledby", `${label.id} ${value.id}`);
    list.setAttribute("aria-labelledby", label.id);

    const options = Array.from(select.options);
    const rows = options.map((option, index) => {
      const row = document.createElement("li");
      row.id = `${list.id}-${index}`;
      row.className = "select-option";
      row.setAttribute("role", "option");
      const text = document.createElement("span");
      text.className = "select-option-text";
      const title = document.createElement("bdi");
      title.textContent = option.text;
      text.append(title);
      if (option.dataset.note) {
        const note = document.createElement("small");
        note.textContent = option.dataset.note;
        text.append(note);
      }
      const tick = icon("check");
      tick.classList.add("option-tick");
      row.append(text, tick);
      row.addEventListener("pointermove", () => activate(index));
      row.addEventListener("mousedown", (event) => event.preventDefault());
      row.addEventListener("click", () => choose(index));
      return row;
    });

    list.append(...rows);
    root.append(trigger, list);
    select.hidden = true;
    select.after(root);

    let activeIndex = 0;
    let search = "";
    let lastTyped = 0;
    const control = { root, close, sync };
    controls.set(select, control);

    function sync() {
      value.textContent = options[select.selectedIndex]?.text ?? "";
      rows.forEach((row, index) => row.setAttribute("aria-selected", String(index === select.selectedIndex)));
    }

    function activate(index, scroll = false) {
      activeIndex = Math.max(0, Math.min(index, rows.length - 1));
      for (const [index, row] of rows.entries()) {
        row.classList.toggle("is-active", index === activeIndex);
      }
      const row = rows[activeIndex];
      trigger.setAttribute("aria-activedescendant", row.id);
      if (scroll) row.scrollIntoView({ block: "nearest" });
    }

    function open() {
      if (trigger.matches(":disabled")) return;
      closeOpenSelect();
      openSelect = control;
      list.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      const bounds = trigger.getBoundingClientRect();
      const above = bounds.top;
      const below = window.innerHeight - bounds.bottom;
      root.classList.toggle("opens-up", below < list.offsetHeight + 12 && above > below);
      activate(select.selectedIndex, true);
    }

    function close() {
      list.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      trigger.removeAttribute("aria-activedescendant");
      root.classList.remove("opens-up");
      search = "";
      if (openSelect === control) openSelect = null;
    }

    function choose(index) {
      if (trigger.matches(":disabled")) return;
      const changed = select.selectedIndex !== index;
      select.selectedIndex = index;
      close();
      sync();
      trigger.focus({ preventScroll: true });
      if (changed) select.dispatchEvent(new Event("change", { bubbles: true }));
    }

    trigger.addEventListener("click", () => {
      if (openSelect === control) close();
      else open();
    });
    trigger.addEventListener("blur", close);
    trigger.addEventListener("keydown", (event) => {
      const expanded = openSelect === control;
      switch (event.key) {
        case "Tab":
          close();
          return;
        case "Escape":
          if (!expanded) return;
          close();
          break;
        case "Enter":
        case " ":
          if (expanded) choose(activeIndex);
          else open();
          break;
        case "ArrowDown":
        case "ArrowUp":
          if (expanded) activate(activeIndex + (event.key === "ArrowDown" ? 1 : -1), true);
          else open();
          break;
        case "Home":
        case "End":
          if (!expanded) open();
          activate(event.key === "Home" ? 0 : rows.length - 1, true);
          break;
        default: {
          if (event.key.length !== 1 || event.ctrlKey || event.altKey || event.metaKey) return;
          if (!expanded) open();
          const now = performance.now();
          search = (now - lastTyped < 650 ? search : "") + event.key.toLowerCase();
          lastTyped = now;
          const match = options.findIndex((option) => option.text.toLowerCase().startsWith(search));
          if (match !== -1) activate(match, true);
        }
      }
      event.preventDefault();
    });
    sync();
  }

  return {
    close: closeOpenSelect,
    sync: () => { for (const control of controls.values()) control.sync(); },
  };
}
