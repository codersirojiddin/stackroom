(function(){
  try{
    document.documentElement.classList.add('js-ready');

    // ---- scroll progress rail ----
    var fill = document.getElementById('scrollFill');
    function onScroll(){
      var h = document.documentElement;
      var max = (h.scrollHeight - h.clientHeight) || 1;
      var pct = Math.min(100, Math.max(0, (window.scrollY / max) * 100));
      if(fill) fill.value = pct;
    }
    document.addEventListener('scroll', onScroll, {passive:true});
    onScroll();

    // ---- side nav active state ----
    var navLinks = Array.prototype.slice.call(document.querySelectorAll('.side-nav a'));
    var navSections = navLinks.map(function(a){ return document.querySelector(a.getAttribute('href')); }).filter(Boolean);

    if('IntersectionObserver' in window){
      var navObserver = new IntersectionObserver(function(entries){
        entries.forEach(function(entry){
          var idx = navSections.indexOf(entry.target);
          if(idx === -1) return;
          if(entry.isIntersecting){
            navLinks.forEach(function(a){ a.classList.remove('active'); });
            navLinks[idx].classList.add('active');
          }
        });
      }, {rootMargin:'-45% 0px -45% 0px'});
      navSections.forEach(function(s){ navObserver.observe(s); });

      // ---- generic reveal / stagger / diagram / connector observer ----
      var revealTargets = document.querySelectorAll('.reveal, .stagger, .diagram');
      var revealObserver = new IntersectionObserver(function(entries){
        entries.forEach(function(entry){
          if(entry.isIntersecting){
            entry.target.classList.add('in-view');
            revealObserver.unobserve(entry.target);
          }
        });
      }, {threshold:0.16, rootMargin:'0px 0px -6% 0px'});
      revealTargets.forEach(function(t){ revealObserver.observe(t); });

      // ---- count-up numbers ----
      var counters = document.querySelectorAll('[data-count-to]');
      var countObserver = new IntersectionObserver(function(entries){
        entries.forEach(function(entry){
          if(!entry.isIntersecting) return;
          countObserver.unobserve(entry.target);
          var el = entry.target;
          var target = parseInt(el.getAttribute('data-count-to'), 10) || 0;
          var start = null; var dur = 900;
          function step(ts){
            if(!start) start = ts;
            var p = Math.min(1, (ts - start) / dur);
            var eased = 1 - Math.pow(1 - p, 3);
            el.textContent = Math.round(eased * target);
            if(p < 1) requestAnimationFrame(step);
          }
          requestAnimationFrame(step);
        });
      }, {threshold:0.4});
      counters.forEach(function(c){ countObserver.observe(c); });

      // ---- health bar fill ----
      var fills = document.querySelectorAll('[data-fill-to]');
      var fillObserver = new IntersectionObserver(function(entries){
        entries.forEach(function(entry){
          if(!entry.isIntersecting) return;
          fillObserver.unobserve(entry.target);
          entry.target.value = Number(entry.target.getAttribute('data-fill-to')) || 0;
        });
      }, {threshold:0.4});
      fills.forEach(function(f){ fillObserver.observe(f); });

      // ---- search mockup typewriter ----
      var typedEl = document.getElementById('searchTyped');
      var searchWidget = typedEl ? typedEl.closest('.widget') : null;
      if(typedEl && searchWidget){
        var typeObserver = new IntersectionObserver(function(entries){
          entries.forEach(function(entry){
            if(!entry.isIntersecting) return;
            typeObserver.unobserve(entry.target);
            var word = 'neon'; var i = 0;
            var t = setInterval(function(){
              typedEl.textContent = word.slice(0, i+1);
              i++;
              if(i >= word.length) clearInterval(t);
            }, 110);
          });
        }, {threshold:0.5});
        typeObserver.observe(searchWidget);
      }
    } else {
      // no IntersectionObserver: reveal everything immediately, counters show final values
      document.querySelectorAll('.reveal, .stagger, .diagram').forEach(function(t){ t.classList.add('in-view'); });
      document.querySelectorAll('[data-count-to]').forEach(function(el){ el.textContent = el.getAttribute('data-count-to'); });
      document.querySelectorAll('[data-fill-to]').forEach(function(el){ el.value = Number(el.getAttribute('data-fill-to')) || 0; });
      var typedElFallback = document.getElementById('searchTyped');
      if(typedElFallback) typedElFallback.textContent = 'neon';
    }

    // ---- infra diagram pulse dot along the path (progressive enhancement) ----
    var path = document.getElementById('infraPathA');
    var pulse = document.getElementById('infraPulse');
    if(path && pulse && 'getPointAtLength' in path){
      var len = path.getTotalLength();
      var t0 = null;
      function movePulse(ts){
        if(!t0) t0 = ts;
        var dur = 2600;
        var p = ((ts - t0) % dur) / dur;
        var pt = path.getPointAtLength(p * len);
        pulse.setAttribute('cx', pt.x);
        pulse.setAttribute('cy', pt.y);
        requestAnimationFrame(movePulse);
      }
      requestAnimationFrame(movePulse);
    }
  }catch(e){ /* fail silently: static content above remains fully correct without JS */ }
})();