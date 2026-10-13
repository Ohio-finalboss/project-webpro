(() => {
  const pageSize = 10;

  function initializeTablePagination() {
    document.querySelectorAll('table').forEach((table) => {
      if (table.dataset.paginationReady) return;
      table.dataset.paginationReady = 'true';

      const rows = Array.from(table.tBodies).flatMap((tbody) => Array.from(tbody.rows));
      if (rows.length <= pageSize) return;

      const controls = document.createElement('nav');
      controls.className = 'table-pagination';
      controls.setAttribute('aria-label', 'เปลี่ยนหน้าตาราง');

      const summary = document.createElement('span');
      summary.className = 'table-pagination-summary';
      const pageLabel = document.createElement('span');
      pageLabel.className = 'table-pagination-page';

      const previous = document.createElement('button');
      previous.type = 'button';
      previous.textContent = 'ก่อนหน้า';
      previous.setAttribute('aria-label', 'หน้าก่อนหน้า');
      const next = document.createElement('button');
      next.type = 'button';
      next.textContent = 'ถัดไป';
      next.setAttribute('aria-label', 'หน้าถัดไป');

      const pageCount = Math.ceil(rows.length / pageSize);
      let page = 1;
      const updatePage = () => {
        const start = (page - 1) * pageSize;
        const end = Math.min(start + pageSize, rows.length);
        rows.forEach((row, index) => {
          row.hidden = index < start || index >= end;
        });
        summary.textContent = `แสดง ${start + 1}–${end} จาก ${rows.length} รายการ`;
        pageLabel.textContent = `หน้า ${page} จาก ${pageCount}`;
        previous.disabled = page === 1;
        next.disabled = page === pageCount;
      };

      previous.addEventListener('click', () => {
        if (page > 1) { page -= 1; updatePage(); }
      });
      next.addEventListener('click', () => {
        if (page < pageCount) { page += 1; updatePage(); }
      });

      controls.append(previous, summary, pageLabel, next);
      const container = table.closest('.table-scroll, .table-wrap') || table;
      container.insertAdjacentElement('afterend', controls);
      updatePage();
    });
  }

  document.addEventListener('DOMContentLoaded', initializeTablePagination);
  window.addEventListener('sse:updated', initializeTablePagination);
})();
