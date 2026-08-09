const monthSelect = document.getElementById('filter-month');
const weaponSelect = document.getElementById('filter-weapon');
const formatSelect = document.getElementById('filter-format');
const resetBtn = document.getElementById('reset-filters');
const noResults = document.getElementById('no-results');
const container = document.querySelector('.container');
const events = document.querySelectorAll('.item-container');

const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June', 
                    'July', 'August', 'September', 'October', 'November', 'December'];

function applyFilters() {
  const month = monthSelect.value.toLowerCase();
  const weapon = weaponSelect.value.toLowerCase();
  const format = formatSelect.value.toLowerCase();

  // Sort events by date
  const sortedEvents = Array.from(events).sort((a, b) => {
    const aMonth = parseInt(a.dataset.month);
    const aDay = parseInt(a.dataset.day);
    const bMonth = parseInt(b.dataset.month);
    const bDay = parseInt(b.dataset.day);

    if (aMonth !== bMonth) return aMonth - bMonth;
    return aDay - bDay;
  });

  // Remove all existing month headers
  document.querySelectorAll('.month-header').forEach(header => header.remove());

  // Clear container and rebuild with headers
  container.innerHTML = '';
  
  let previousMonth = null;
  
  sortedEvents.forEach(event => {
    const currentMonth = parseInt(event.dataset.month);
    
    // If month changed, add a header
    if (currentMonth !== previousMonth) {
      const header = document.createElement('div');
      header.className = 'month-header';
      header.textContent = monthNames[currentMonth];
      container.appendChild(header);
      previousMonth = currentMonth;
    }
    
    container.appendChild(event);
  });

  let visibleCount = 0;
  let visibleMonths = new Set(); // Track which months have visible events

  // Apply filters
  sortedEvents.forEach(event => {
    const eMonth = event.dataset.month;
    const eWeapons = event.dataset.weapon.toLowerCase().split(' ');
    const eFormat = event.dataset.format.toLowerCase().split(' ');

    const matchesMonth = month === 'all' || eMonth === month;
    const matchesWeapon = weapon === 'all' || eWeapons.includes(weapon);
    const matchesFormat = format === 'all' || eFormat.includes(format);

    const isMatch = matchesMonth && matchesWeapon && matchesFormat;

    event.classList.toggle('hidden', !isMatch);
    if (isMatch) {
      visibleCount++;
      visibleMonths.add(eMonth); // Add to visible months
    }
  });

  // Hide month headers for months with no visible events
  document.querySelectorAll('.month-header').forEach(header => {
    const headerText = header.textContent.trim();
    const headerMonth = monthNames.indexOf(headerText).toString();
    
    if (visibleMonths.has(headerMonth)) {
      header.classList.remove('hidden');
    } else {
      header.classList.add('hidden');
    }
  });

  if (noResults) {
    noResults.style.display = visibleCount === 0 ? 'block' : 'none';
  }
}

// Call on page load to sort initially
applyFilters();

[monthSelect, weaponSelect, formatSelect].forEach(select => {
  select.addEventListener('change', applyFilters);
});

resetBtn.addEventListener('click', () => {
  monthSelect.value = 'all';
  weaponSelect.value = 'all';
  formatSelect.value = 'all';
  applyFilters();
});