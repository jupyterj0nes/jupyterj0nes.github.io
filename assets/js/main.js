document.addEventListener('DOMContentLoaded', function() {
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.querySelector('.nav-links');

  if (toggle && nav) {
    toggle.addEventListener('click', function(e) {
      e.stopPropagation();
      nav.classList.toggle('active');
    });

    document.addEventListener('click', function(e) {
      if (!toggle.contains(e.target) && !nav.contains(e.target)) {
        nav.classList.remove('active');
      }
    });
  }

  // Mobile dropdown accordions
  document.querySelectorAll('.nav-dropdown .dropdown-trigger').forEach(function(trigger) {
    trigger.addEventListener('click', function(e) {
      if (window.innerWidth > 640) return;

      e.preventDefault();

      var parent = this.closest('.nav-dropdown');
      var wasOpen = parent.classList.contains('open');

      // Close all
      document.querySelectorAll('.nav-dropdown').forEach(function(d) {
        d.classList.remove('open');
      });

      // Toggle clicked
      if (!wasOpen) {
        parent.classList.add('open');
      }
    });
  });
});
