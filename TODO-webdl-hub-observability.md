# WebDL Hub observability TODO

## Open

- [ ] Hub moet expliciet tonen waarom er niets downloadt: actief, wachtend, gepauzeerd, failed-only, of SAB-only activiteit.
- [ ] Hub moet gepauzeerde groepen/lane tonen en direct kunnen hervatten per groep of alles.
- [ ] Generieke fullscale-image controle bouwen voor gallery/image-downloads; Vipergirls is een regressiecase, niet de enige scope.
- [ ] Imports moeten full-size image URL/bestand gebruiken wanneer die herleidbaar is, niet forum/gallery thumbnails.
- [ ] Thumbnail-achtige image URL zonder fullscale-resolutie mag niet als succesvolle download in de gallery landen.
- [ ] Bestaande gallery met terugwerkende kracht auditen op thumbnail-bestanden/URLs en rapporteren welke opnieuw moeten.
- [ ] Detailweergave moet tonen of een image een thumbnail, attachment of full-size bestand is.
- [ ] Regressietest toevoegen voor thumbnail/full-image URL handling.
- [ ] Gallery viewer: tag-knop mag de viewer niet sluiten en moet de tag-UI openen.

## Bevindingen 2026-05-08

- Hubproces draait op poort 35730 en DB health is OK.
- Hubqueue heeft 0 running en 0 normale queued jobs.
- Hubqueue heeft 1085 gepauzeerde jobs; workers kunnen die bewust niet claimen.
- SABnzbd draait wel en downloadt actief via `127.0.0.1:8080`.
- UI toont pauze-count, maar legt niet duidelijk uit dat dit de reden is dat Hub-downloads stil staan.
- Fullscale-audit gedraaid: 275685 image-records gecontroleerd.
- Fullscale-audit vond 7684 confirmed thumbnail-bestanden in de gallery en 13699 records met een thumbnail-bron-URL die per bestand gecontroleerd moeten worden.
- Voor 6062 confirmed thumbnail-bestanden is automatisch een fullscale-kandidaat-URL afgeleid.
