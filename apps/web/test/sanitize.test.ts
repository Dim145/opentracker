import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderMarkdown, sanitizeHtml, sanitizeRichHtml } from '../app/utils/markdown';
import { safeHttpUrl } from '../app/utils/safeUrl';
import { safeInAppPath } from '../app/utils/safePath';

// La frontière XSS de l'application.
//
// Tout ce qui remonte en `v-html` passe par ici : descriptions de torrents,
// posts du forum, personnalisation de l'administration, fiches importées d'un
// autre tracker. Sur un tracker privé, ces textes sont écrits par des membres
// et relus par tous les autres, y compris le staff avec sa session
// d'administration ouverte — un seul `<script>` qui passe et c'est le compte
// administrateur qui tombe.
//
// Le profil DOMPurify est volontairement plus strict que le profil par défaut,
// qui laisse passer `<style>`, `<form>` et les schémas d'URL arbitraires.
// Deux profils coexistent, et c'est là que se situe le vrai risque : le profil
// « riche » rouvre l'attribut `style` pour que le BBCode de mise en forme
// survive. Il ne doit le rouvrir QUE pour une liste blanche de propriétés, et
// surtout ne jamais contaminer le profil strict — les deux partagent la même
// instance DOMPurify et un drapeau de portée.

describe('renderMarkdown', () => {
  it('rend le markdown courant', () => {
    const html = renderMarkdown('# Titre\n\nUn **gras** et un [lien](https://ok.example).');
    expect(html).toContain('<h1');
    expect(html).toContain('<strong>gras</strong>');
    expect(html).toContain('href="https://ok.example"');
  });

  it('supprime le script inséré en HTML brut', () => {
    const html = renderMarkdown('Bonjour <script>alert(1)</script> tout le monde');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
  });

  it('neutralise les gestionnaires d’événements', () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain('onerror');
  });

  it('refuse les schémas d’URL exécutables sur un lien markdown', () => {
    // `[clic](javascript:…)` est la forme la plus courante : elle traverse
    // marked sans encombre et n'est arrêtée que par ALLOWED_URI_REGEXP.
    for (const mauvais of [
      '[clic](javascript:alert(1))',
      '[clic](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
      '[clic](vbscript:msgbox)',
    ]) {
      const html = renderMarkdown(mauvais);
      expect(html).not.toMatch(/javascript:|data:text\/html|vbscript:/i);
    }
  });

  it('laisse passer http, https, mailto et les ancres', () => {
    expect(renderMarkdown('[a](https://ok.example)')).toContain('https://ok.example');
    expect(renderMarkdown('[a](http://ok.example)')).toContain('http://ok.example');
    expect(renderMarkdown('[a](mailto:x@ok.example)')).toContain('mailto:');
    expect(renderMarkdown('[a](#section)')).toContain('#section');
  });

  it('durcit les liens sortants contre le tabnabbing', () => {
    const html = renderMarkdown('[a](https://ailleurs.example)');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it('laisse les ancres internes sans cible externe', () => {
    expect(renderMarkdown('[a](#bas)')).not.toContain('target="_blank"');
  });

  it('retire les balises structurelles dangereuses', () => {
    const html = sanitizeHtml(
      '<style>body{display:none}</style><form action="/x"><input name="p"></form>' +
        '<iframe src="https://evil.example"></iframe><base href="https://evil.example">',
    );
    for (const balise of ['<style', '<form', '<input', '<iframe', '<base']) {
      expect(html).not.toContain(balise);
    }
  });

  it('rend une chaîne vide plutôt que « null »', () => {
    expect(renderMarkdown(null)).toBe('');
    expect(renderMarkdown(undefined)).toBe('');
    expect(sanitizeHtml('')).toBe('');
  });
});

describe('sanitizeRichHtml — l’attribut style rouvert, mais bordé', () => {
  it('conserve les propriétés purement présentationnelles', () => {
    // Ce sont exactement celles que le BBCode émet : [center], [color], [size].
    const html = sanitizeRichHtml(
      '<p style="text-align:center;color:#ff0000;font-size:1.2em">Salut</p>',
    );
    expect(html).toContain('text-align: center');
    expect(html).toContain('color: #ff0000');
    expect(html).toContain('font-size: 1.2em');
  });

  it('jette les propriétés hors liste blanche', () => {
    const html = sanitizeRichHtml(
      '<p style="position:fixed;top:0;left:0;z-index:9999;opacity:0;color:red">x</p>',
    );
    // Un bloc positionné en superposition est un détournement de clic, pas
    // une mise en forme.
    expect(html).not.toContain('position');
    expect(html).not.toContain('z-index');
    expect(html).toContain('color: red');
  });

  it('jette les valeurs capables d’aller chercher une ressource ou de s’échapper', () => {
    for (const mauvais of [
      'background-color: url(https://pisteur.example/x.png)',
      'color: expression(alert(1))',
      'font-family: javascript:alert(1)',
      'color: red} body { display:none',
      'font-size: 12px; /* @import "evil" */',
    ]) {
      const html = sanitizeRichHtml(`<p style="${mauvais}">x</p>`);
      expect(html).not.toMatch(/url\(|expression\(|javascript:|@import|[{}]/);
    }
  });

  it('lâche un style absurdement long en bloc', () => {
    const html = sanitizeRichHtml(`<p style="${'color:red;'.repeat(100)}">x</p>`);
    expect(html).not.toContain('style');
  });

  it('garde la même sévérité que le profil strict sur tout le reste', () => {
    const html = sanitizeRichHtml(
      '<script>alert(1)</script><a href="javascript:alert(1)">x</a><iframe></iframe>',
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<iframe');
  });

  it('n’a pas desserré le profil strict au passage', () => {
    // Les deux profils partagent une instance DOMPurify et un drapeau de
    // portée. Si le crochet du profil riche fuyait, le style survivrait ici —
    // et toute la personnalisation d'administration deviendrait injectable.
    sanitizeRichHtml('<p style="color:red">riche</p>');
    expect(sanitizeHtml('<p style="color:red">strict</p>')).not.toContain('style');
    expect(renderMarkdown('<p style="color:red">strict</p>')).not.toContain('style');
  });
});

describe('safeHttpUrl', () => {
  it('n’accepte qu’une URL http(s) absolue', () => {
    expect(safeHttpUrl('https://ok.example/x')).toBe('https://ok.example/x');
    expect(safeHttpUrl('  http://ok.example/  ')).toBe('http://ok.example/');
  });

  it('refuse tout le reste', () => {
    for (const mauvais of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      '//evil.example/x',
      '/chemin/relatif',
      'ftp://ok.example',
      'https://',
      42,
      null,
      undefined,
    ]) {
      expect(safeHttpUrl(mauvais)).toBeNull();
    }
  });
});

describe('safeInAppPath', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('accepte un chemin absolu de l’application', () => {
    expect(safeInAppPath('/torrents/42')).toBe('/torrents/42');
  });

  it('refuse tout ce qui pourrait sortir du site', () => {
    // Le lien vient d'une ligne de notification écrite côté serveur, et part
    // dans `router.push`. Une URL protocole-relative y suffit à emmener le
    // membre ailleurs — support idéal pour une page de phishing.
    for (const mauvais of ['//evil.example/x', 'https://evil.example', 'evil', '', null, undefined]) {
      expect(safeInAppPath(mauvais)).toBe('/');
    }
  });

  it('vérifie l’origine réelle quand le navigateur est là', () => {
    vi.stubGlobal('window', { location: { origin: 'https://tracker.example' } });
    expect(safeInAppPath('/torrents?page=2#haut')).toBe('/torrents?page=2#haut');
    // `/\evil.example` : certains navigateurs traitent l'antislash comme une
    // barre oblique et partent hors origine.
    expect(safeInAppPath('/\\evil.example')).toBe('/');
  });
});
