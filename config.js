/* APOLOGEA Handy-App – Einstellungen
   Nach der einmaligen Anmeldung der App bei Microsoft hier die „Anwendungs-ID (Client-ID)“ eintragen.
   Diese ID ist kein Geheimnis; sie darf öffentlich im App-Code stehen. */
window.APOLOGEA_CONFIG = {
  // Anwendungs-ID aus dem Microsoft-Entra-Portal (App-Registrierungen), z. B. "1a2b3c4d-...."
  clientId: 'c3bcf34c-e842-44d7-a5e4-c9c702d1d208',

  // "consumers" = persönliches Microsoft-Konto (privates OneDrive). Für ein Firmenkonto "common" eintragen.
  authority: 'https://login.microsoftonline.com/consumers',

  // Vorgeschlagener Ort der Sammlung im OneDrive (kann in der App geändert werden)
  sammlungPfad: 'Desktop/APOLOGEA_PC_mit_Suchkatalog/APOLOGEA_Arbeitsprogramm/Sammlung'
};
