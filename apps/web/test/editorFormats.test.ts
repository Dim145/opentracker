import { describe, it, expect } from 'vitest';
import {
  bbcodeToHtml,
  detectFormat,
  htmlToMarkdown,
  markdownToHtml,
  toEditorHtml,
} from '../app/utils/editorFormats';

// L'éditeur accepte indifféremment du Markdown, du HTML ou du BBCode : c'est
// ce qui permet de coller une fiche venue d'un autre tracker sans la refaire.
// La détection de format est donc un aiguillage silencieux — se tromper ne
// lève aucune erreur, ça affiche simplement les délimiteurs en clair au milieu
// du texte.
//
// Le convertisseur BBCode, lui, est la seule partie du projet qui fabrique du
// HTML brut à partir d'une entrée utilisateur. Il échappe tout d'entrée et ne
// réinjecte que ce qu'il émet lui-même ; ces tests figent cette discipline,
// puis vérifient que `toEditorHtml` repasse quand même le résultat au
// désinfectant — la défense en profondeur qui rattraperait une future balise
// mal écrite.

describe('detectFormat', () => {
  it('reconnaît le BBCode à sa balise fermante', () => {
    // C'est ce qui le distingue d'un lien Markdown `[libellé](url)`.
    expect(detectFormat('[b]gras[/b]')).toBe('bbcode');
    expect(detectFormat('[center][size=13]Fiche[/size][/center]')).toBe('bbcode');
  });

  it('ne prend pas un lien markdown pour du BBCode', () => {
    expect(detectFormat('Voir [le site](https://ok.example)')).toBe('markdown');
  });

  it('privilégie le markdown même quand du HTML en ligne s’y mêle', () => {
    // Beaucoup de trackers acceptaient déjà `<u>` par-dessus du Markdown. Une
    // sonde naïve « contient une balise HTML » classait ça en HTML pur, et les
    // `**` finissaient affichés tels quels.
    expect(detectFormat('**gras** et <u>souligné</u>')).toBe('markdown');
    expect(detectFormat('# Titre\n\n<br>ligne')).toBe('markdown');
  });

  it('reconnaît le HTML quand il n’y a aucune syntaxe markdown', () => {
    expect(detectFormat('<p>Bonjour <b>toi</b></p>')).toBe('html');
  });

  it('retombe sur markdown pour du texte nu ou vide', () => {
    expect(detectFormat('juste une phrase')).toBe('markdown');
    expect(detectFormat('   ')).toBe('markdown');
  });
});

describe('bbcodeToHtml — mise en forme', () => {
  it('traduit les balises simples et imbriquées', () => {
    const html = bbcodeToHtml('[b][i]les deux[/i][/b]');
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');
  });

  it('résout les emballages de même type imbriqués', () => {
    // Le défaut historique, visible sur les torrents exportés d'un forum : un
    // `[size=13]` extérieur se refermait sur le premier `[/size]` intérieur,
    // et le `[size=10]` orphelin s'affichait en toutes lettres.
    const html = bbcodeToHtml('[size=13]dehors [size=10]dedans[/size] retour[/size]');
    expect(html).not.toContain('[size=');
    expect(html).not.toContain('[/size]');
    expect(html.match(/font-size/g)).toHaveLength(2);
  });

  it('borne une taille aberrante au lieu de faire exploser la mise en page', () => {
    expect(bbcodeToHtml('[size=300]énorme[/size]')).toContain('font-size:48px');
    expect(bbcodeToHtml('[size=1]minuscule[/size]')).toContain('font-size:0.80em');
  });

  it('convertit les listes ordonnées et non ordonnées', () => {
    expect(bbcodeToHtml('[list][*]un[*]deux[/list]')).toBe('<ul><li>un</li><li>deux</li></ul>');
    expect(bbcodeToHtml('[list=1][*]un[/list]')).toBe('<ol><li>un</li></ol>');
  });

  it('reprend les dimensions numériques d’une image', () => {
    const a = bbcodeToHtml('[img width=75]https://ok.example/p.jpg[/img]');
    expect(a).toContain('width="75"');
    const b = bbcodeToHtml('[img=320x180]https://ok.example/p.jpg[/img]');
    expect(b).toContain('width="320"');
    expect(b).toContain('height="180"');
  });

  it('garde les deux paragraphes sous un même emballage', () => {
    const html = bbcodeToHtml('[size=13]para 1\n\npara 2[/size]');
    expect(html.match(/font-size/g)).toHaveLength(1);
    expect(html).toContain('para 2');
  });
});

describe('bbcodeToHtml — l’entrée n’est pas de confiance', () => {
  it('échappe le HTML présent dans l’entrée', () => {
    const html = bbcodeToHtml('<script>alert(1)</script>');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
  });

  it('n’émet un lien que pour http(s)', () => {
    expect(bbcodeToHtml('[url=javascript:alert(1)]clic[/url]')).not.toContain('<a ');
    expect(bbcodeToHtml('[url=https://ok.example]clic[/url]')).toContain(
      'href="https://ok.example"',
    );
    // Le libellé reste visible : on retire le lien, pas le texte.
    expect(bbcodeToHtml('[url=javascript:alert(1)]clic[/url]')).toContain('clic');
  });

  it('n’émet une image que pour http(s)', () => {
    expect(bbcodeToHtml('[img]javascript:alert(1)[/img]')).toBe('');
    expect(bbcodeToHtml('[img]data:image/svg+xml,<svg onload=alert(1)>[/img]')).toBe('');
  });

  it('refuse une couleur qui n’en est pas une', () => {
    const html = bbcodeToHtml('[color=red;background:url(https://pisteur.example)]x[/color]');
    expect(html).not.toContain('url(');
    expect(html).toContain('x');
  });

  it('durcit les liens sortants', () => {
    expect(bbcodeToHtml('[url=https://ailleurs.example]x[/url]')).toContain(
      'rel="noopener noreferrer"',
    );
  });
});

describe('toEditorHtml — l’aiguillage complet', () => {
  it('désinfecte quel que soit le chemin emprunté', () => {
    // Trois formats, une seule garantie : rien d'exécutable n'atteint TipTap.
    expect(toEditorHtml('<script>alert(1)</script>')).not.toContain('<script');
    expect(toEditorHtml('[b]<script>alert(1)</script>[/b]')).not.toContain('<script');
    expect(toEditorHtml('# Titre\n<script>alert(1)</script>')).not.toContain('<script');
  });

  it('préserve la mise en forme du BBCode via le profil riche', () => {
    // Le profil strict retirait tous les `style` et faisait disparaître
    // [center], [color] et [size] à l'ouverture de l'éditeur.
    const html = toEditorHtml('[center][color=#ff0000]Rouge centré[/color][/center]');
    expect(html).toContain('text-align');
    expect(html).toContain('color');
    expect(html).toContain('Rouge centré');
  });

  it('rend une chaîne vide sur une entrée absente', () => {
    expect(toEditorHtml(null)).toBe('');
    expect(toEditorHtml(undefined)).toBe('');
    expect(toEditorHtml('')).toBe('');
  });
});

describe('aller-retour markdown ↔ html', () => {
  it('conserve la structure courante', () => {
    const md = '# Titre\n\nUn **gras**, un *italique* et un [lien](https://ok.example).';
    const retour = htmlToMarkdown(markdownToHtml(md));
    expect(retour).toContain('# Titre');
    expect(retour).toContain('**gras**');
    expect(retour).toContain('[lien](https://ok.example)');
  });

  it('conserve les listes et les blocs de code', () => {
    const md = '- un\n- deux\n\n```\ncode\n```';
    const retour = htmlToMarkdown(markdownToHtml(md));
    expect(retour).toMatch(/^-\s+un$/m);
    expect(retour).toContain('```');
  });

  it('préserve le souligné, que le markdown ne sait pas écrire', () => {
    // Sans la règle turndown dédiée, `<u>` disparaissait à l'enregistrement.
    expect(htmlToMarkdown('<p><u>souligné</u></p>')).toContain('<u>souligné</u>');
  });

  it('préserve le centrage', () => {
    const md = htmlToMarkdown('<p style="text-align:center">centré</p>');
    expect(md).toContain('text-align:center');
  });

  it('est stable à la seconde passe', () => {
    // C'est ce qui compte vraiment : ouvrir puis réenregistrer une fiche sans
    // y toucher ne doit pas la faire dériver un peu plus à chaque fois.
    const md = '# Titre\n\nUn **gras** et une liste :\n\n- un\n- deux';
    const un = htmlToMarkdown(markdownToHtml(md));
    const deux = htmlToMarkdown(markdownToHtml(un));
    expect(deux).toBe(un);
  });
});
