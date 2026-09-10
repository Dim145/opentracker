import { describe, expect, it } from 'vitest';
import {
  assignVersionMarkers,
  releaseGroup,
  releaseTags,
  type VersionFacts,
} from '~/utils/versionMarkers';

/*
 * Les repères de version, mesurés sur le catalogue de test.
 *
 * Tous les noms ci-dessous sont recopiés de la base — c'est la seule façon de
 * vérifier ce qui compte réellement, à savoir ce que l'analyseur de noms tire
 * de VRAIS noms de release. Un jeu de noms inventés confirme l'algorithme et
 * rate le vocabulaire : `AAC.2.0` ne produit pas le jeton `AAC` mais `2.0`,
 * `DDP2.0` n'en produit aucun, et les deux comptent pour « Compat ».
 */

function facts(name: string, size: number): VersionFacts {
  return { size, tags: releaseTags(name) };
}

const GIB = 1024 ** 3;

describe('assignVersionMarkers', () => {
  it("ne pose aucun repère sur une version seule : il n'y a rien à arbitrer", () => {
    expect(
      assignVersionMarkers([
        facts('Cats.Eye.S01.MULTi.1080p.BluRay.x264-KAZETV', 56306370355),
      ]),
    ).toEqual([null]);
  });

  /*
   * Les quatre versions de `Sousou.no.Frieren.S01E09` — l'unité que le tracker
   * de référence affiche, et le cas pour lequel la fonctionnalité existe.
   */
  it('sépare les quatre versions d’un même épisode', () => {
    const markers = assignVersionMarkers([
      facts('Sousou.no.Frieren.S01E09.MULTi.2160p.WEB-DL.DDP5.1.HDR.HEVC-FLUX', 4509715660),
      facts('Sousou.no.Frieren.S01E09.VOSTFR.1080p.WEB-DL.AAC.2.0.H.264-TsundereRaws', 1476395008),
      facts('Sousou.no.Frieren.S01E09.VF.1080p.WEB-DL.EAC3.2.0.H.264-QCTeam', 1395864371),
      facts('Sousou.no.Frieren.S01E09.VOSTFR.1080p.WEBRip.AAC.2.0.x265-NOTAG', 734003200),
    ]);
    expect(markers).toEqual([
      // 2160p + HDR : seule sur ces deux axes.
      'imageMax',
      // H.264, pas de piste lossless, 1080p — et la plus grosse des deux
      // candidates, donc la meilleure des versions qui lisent partout.
      'compat',
      // Également compatible, mais le repère ne se pose qu'une fois.
      null,
      // 0,73 Gio contre 1,40 pour la suivante : l'écart est réel.
      'light',
    ]);
  });

  /*
   * La panne qui a motivé ce fichier, à l'intérieur d'une unité cette fois :
   * le WEB-DL pèse presque le double du BluRay et n'a pas la meilleure image.
   */
  it('couronne la source, pas la taille', () => {
    const webdl = facts(
      'Sousou.no.Frieren.S01.VOSTFR.1080p.WEB-DL.AAC.2.0.H.264-TsundereRaws',
      42924507136,
    );
    const bluray = facts(
      'Sousou.no.Frieren.S01.MULTi.1080p.BluRay.x265.10bit.FLAC.2.0-KAWAII',
      22412347300,
    );
    expect(assignVersionMarkers([webdl, bluray])).toEqual([
      'compat',
      'imageMax',
    ]);
  });

  it('ne reporte pas « Léger » sur la deuxième plus petite', () => {
    // Les trois éditions de Dune du catalogue. « Léger » saute : 18,2536 et
    // 18,2547 Gio ne se distinguent pas, et la plus petite reste la deuxième
    // plus grosse du lot. « Son d'origine » saute aussi, pour l'autre raison —
    // les TROIS ont une piste intacte (TrueHD, DTS-HD, DTS-HD), donc le repère
    // n'aiderait personne à choisir.
    const markers = assignVersionMarkers([
      facts('Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.DV.HDR.HEVC.TrueHD', 88627884028),
      facts('Dune.Part.Two.2024.PROPER.1080p.BluRay.x264.DTS-HD.MA.5.1-Sb', 18254663696),
      facts('Dune.Part.Two.2024.1080p.BluRay.x264.DTS-HD.MA.5.1-SbR', 18253615104),
    ]);
    expect(markers).toEqual(['imageMax', null, null]);
  });

  it('descend « Son d’origine » sur la meilleure ligne encore libre', () => {
    // Le REMUX gagne l'image et porte AUSSI la piste d'origine. Le repère ne
    // disparaît pas pour autant : il descend au BluRay DTS-HD, qui l'a
    // réellement. C'est ce qui distingue une PROPRIÉTÉ d'un extremum.
    const markers = assignVersionMarkers([
      facts('Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.DV.HDR.HEVC.TrueHD', 88 * GIB),
      facts('Dune.Part.Two.2024.1080p.BluRay.x264.DTS-HD.MA.5.1-Sb', 18 * GIB),
      facts('Dune.Part.Two.2024.1080p.WEB-DL.AAC.2.0.H.264-Nope', 5 * GIB),
    ]);
    // Et « Léger » saute : la plus petite porte déjà « Compat ».
    expect(markers).toEqual(['imageMax', 'audioOriginal', 'compat']);
  });

  it("tait un repère que toutes les versions porteraient", () => {
    // Les deux versions de l'épisode 10 : même résolution, même source, aucune
    // piste lossless, toutes deux en H.264. Rien ne les sépare que la langue,
    // qui a sa propre colonne — donc aucun repère, et 1,50 contre 1,61 Gio
    // n'est pas un écart de taille.
    const markers = assignVersionMarkers([
      facts('Sousou.no.Frieren.S01E10.MULTi.1080p.WEB-DL.DDP2.0.H.264-VARYG', 1610612736),
      facts('Sousou.no.Frieren.S01E10.VOSTFR.1080p.WEB-DL.AAC.2.0.H.264-TsundereRaws', 1503238553),
    ]);
    expect(markers).toEqual([null, null]);
  });

  it('n’invente pas de meilleure image entre deux versions identiques', () => {
    const markers = assignVersionMarkers([
      facts('Some.Show.S01E01.VOSTFR.1080p.WEB-DL.AAC.2.0.H.264-A', 4 * GIB),
      facts('Some.Show.S01E01.VOSTFR.1080p.WEB-DL.AAC.2.0.H.264-B', 2 * GIB),
    ]);
    // Aucune image « max » : les deux sont 1080p WEB-DL sans HDR. Seul l'écart
    // de taille dit quelque chose.
    expect(markers).toEqual([null, 'light']);
  });

  it('ne dit pas « lit partout » d’un 2160p H.264', () => {
    const markers = assignVersionMarkers([
      facts('Some.Movie.2024.2160p.WEB-DL.AAC.2.0.H.264-A', 40 * GIB),
      facts('Some.Movie.2024.1080p.WEBRip.HEVC-B', 4 * GIB),
    ]);
    // Le 2160p prend l'image ; « Compat » n'est attribué à personne, le HEVC
    // n'y ayant pas droit et le 2160p passant le plafond de résolution.
    expect(markers).toEqual(['imageMax', 'light']);
  });

  it('ignore une taille inconnue plutôt que de la déclarer légère', () => {
    const markers = assignVersionMarkers([
      facts('Some.Movie.2024.1080p.BluRay.x264.DTS-HD.MA.5.1-A', 10 * GIB),
      facts('Some.Movie.2024.1080p.BluRay.x264.AAC-B', 0),
    ]);
    expect(markers[1]).not.toBe('light');
  });

  it('survit à un nom que l’analyseur ne comprend pas', () => {
    const markers = assignVersionMarkers([
      { size: 1, tags: [] },
      { size: 2, tags: [] },
    ]);
    // Rien à dire : aucune résolution, aucune source, aucun codec. Et la plus
    // petite ne gagne pas « Léger » parce que 1 ⩽ 2 × 0,9 — elle le gagne,
    // justement, et c'est la seule chose que deux tailles connues permettent
    // d'affirmer.
    expect(markers).toEqual(['light', null]);
  });
});

describe('releaseTags', () => {
  it('rend les jetons que les colonnes affichent', () => {
    const tags = releaseTags(
      'Sousou.no.Frieren.S01E09.MULTi.2160p.WEB-DL.DDP5.1.HDR.HEVC-FLUX',
    );
    expect(tags).toContain('2160p');
    expect(tags).toContain('WEB-DL');
    expect(tags).toContain('HDR');
    expect(tags).toContain('HEVC');
  });
});

describe('releaseGroup', () => {
  /*
   * Les quatre noms de l'unité `S01E09` plus l'intégrale, recopiés de la base :
   * c'est la colonne qui départage deux versions que la langue, la résolution
   * et la source égalisent toutes les trois.
   */
  it('rend le suffixe des vrais noms du catalogue', () => {
    expect(
      [
        'Sousou.no.Frieren.S01E09.MULTi.2160p.WEB-DL.DDP5.1.HDR.HEVC-FLUX',
        'Sousou.no.Frieren.S01E09.VOSTFR.1080p.WEB-DL.AAC.2.0.H.264-TsundereRaws',
        'Sousou.no.Frieren.S01E09.VF.1080p.WEB-DL.EAC3.2.0.H.264-QCTeam',
        'Sousou.no.Frieren.S01E09.VOSTFR.1080p.WEBRip.AAC.2.0.x265-NOTAG',
        'Sousou no Frieren - Integrale MULTi 1080p BluRay x265 10bit FLAC-KAWAII',
        'Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.DV.HDR.HEVC.TrueHD.7.1.Atmos-FraMeSToR',
      ].map(releaseGroup),
    ).toEqual([
      'FLUX',
      'TsundereRaws',
      'QCTeam',
      'NOTAG',
      'KAWAII',
      'FraMeSToR',
    ]);
  });

  it("ne prend pas la queue d'un titre pour un groupe", () => {
    // Un chiffre seul et une lettre seule ne sont pas des groupes ; c'est le
    // garde-fou que `stripGroup` n'a pas, parce qu'il n'en a pas besoin.
    expect(releaseGroup('Kill.Bill.Vol-2')).toBeNull();
    expect(releaseGroup('Some.Movie.2024.1080p.BluRay')).toBeNull();
    expect(releaseGroup('Rec-A')).toBeNull();
  });
});

describe('la borne est au composant, pas ici', () => {
  /*
   * Le contrat que `VersionsTable.vue` doit tenir, écrit noir sur blanc.
   *
   * Cette fonction ne SAIT pas ce qu'est une unité : donnée deux saisons, elle
   * les compare, et le résultat est exactement le mensonge de départ — la
   * saison 2 couronnée « Image max » sur la fiche de la saison 1, qui se voit
   * reléguée à « Compat ». Les deux repères sont VRAIS ligne par ligne et la
   * phrase qu'ils forment est fausse, ce qui est précisément pourquoi aucun
   * garde-fou ne peut vivre ici. C'est le composant qui envoie une portée
   * (`scope=season&season=1`) et qui refuse de calculer quand la portée `all`
   * mélange les découpes d'une série (`bounded`).
   */
  it('compare deux saisons sans broncher si on la laisse faire', () => {
    const markers = assignVersionMarkers([
      facts('Cats.Eye.S01.MULTi.1080p.BluRay.x264-KAZETV', 56306370355),
      facts('Cats.Eye.S02.MULTi.2160p.BluRay.x265-KAZETV', 57872165399),
    ]);
    expect(markers).toEqual(['compat', 'imageMax']);
  });

  /*
   * Les deux saisons RÉELLES du catalogue, elles, ne reçoivent rien — non pas
   * parce que la borne aurait servi, mais parce qu'elles sont identiques sur
   * les trois axes de l'image et que 52,4 contre 53,9 Gio n'est pas un écart.
   * Un rendu propre pour la mauvaise raison : mesuré, pour qu'on ne le prenne
   * pas pour une preuve que mélanger les unités est sans conséquence.
   */
  it('ne pose rien sur les deux saisons du catalogue, par égalité', () => {
    const markers = assignVersionMarkers([
      facts('Cats.Eye.S02.MULTi.1080p.BluRay.x264-KAZETV', 57872165399),
      facts('Cats.Eye.S01.MULTi.1080p.BluRay.x264-KAZETV', 56306370355),
    ]);
    expect(markers).toEqual([null, null]);
  });
});
