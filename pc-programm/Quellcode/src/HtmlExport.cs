// APOLOGEA Kollektionsverwaltung – eigenständig lesbarer HTML-Suchkatalog (reine Ansicht)
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;

namespace Apologea
{
    public static class HtmlExport
    {
        static string UrlPath(string rel)
        {
            return string.Join("/", rel.Replace('\\', '/').Split('/').Select(s => Uri.EscapeDataString(s)));
        }

        public static string Build(Collection col)
        {
            var list = new List<object>();
            foreach (var p in col.All().OrderBy(x => x.Nummer))
            {
                var d = new Dictionary<string, object>();
                d["n"] = p.Nummer;
                d["nt"] = p.NummerText;
                d["name"] = p.Name;
                d["motiv"] = p.Motivtitel;
                d["kat"] = p.Kategorie;
                d["serie"] = p.Serie;
                d["text"] = p.Beschreibung;
                d["tags"] = p.Schlagwoerter;
                d["status"] = col.Status(p);
                d["ordner"] = Util.RelPath(col.Root, p.Dir);
                var imgs = new List<object>();
                foreach (var r in Piece.Roles)
                {
                    string rel;
                    p.Bilder.TryGetValue(r, out rel);
                    if (rel != null && p.Dateien.ContainsKey(rel)) imgs.Add(UrlPath(Util.RelPath(col.Root, Path.Combine(p.Dir, rel))));
                    else imgs.Add(null);
                }
                d["img"] = imgs;
                list.Add(d);
            }
            string data = Json.Write(list, false);
            var sb = new StringBuilder();
            sb.Append("<!doctype html><html lang=\"de\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">");
            sb.Append("<title>APOLOGEA – Katalogansicht</title><style>");
            sb.Append(@":root{--bg:#0e0d0c;--panel:#181715;--line:#34302a;--gold:#b8955a;--ivory:#ece4d3;--muted:#a69d8c}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ivory);font:15px/1.5 'Segoe UI',system-ui,sans-serif}
header{padding:28px 32px 18px;border-bottom:1px solid var(--line);display:flex;align-items:flex-end;gap:24px;flex-wrap:wrap}
h1{font:400 30px 'Palatino Linotype','Book Antiqua',Georgia,serif;letter-spacing:.32em;color:var(--gold);margin:0}
header p{margin:0;color:var(--muted)}.bar{position:sticky;top:0;z-index:3;background:rgba(14,13,12,.96);padding:14px 32px;display:flex;gap:12px;flex-wrap:wrap;align-items:center;border-bottom:1px solid var(--line)}
input,select{font:inherit;color:var(--ivory);background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:9px 12px}input{flex:1;min-width:220px}
#count{color:var(--muted)}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:18px;padding:24px 32px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden;cursor:pointer}.card:hover{border-color:var(--gold)}
.card img{width:100%;aspect-ratio:4/5;object-fit:cover;display:block;background:#222}.card .t{padding:10px 12px}.nr{color:var(--gold);font-size:12px;letter-spacing:.12em}
.nm{font:500 17px 'Palatino Linotype',Georgia,serif;letter-spacing:.06em}.sub{color:var(--muted);font-size:13px}
dialog{background:var(--panel);color:var(--ivory);border:1px solid var(--gold);border-radius:10px;max-width:1200px;width:94vw;padding:24px}
dialog::backdrop{background:rgba(0,0,0,.75)}.imgs{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.imgs figure{margin:0}
.imgs img{width:100%;max-height:60vh;object-fit:contain;background:#2a2724;border-radius:6px}.imgs figcaption{color:var(--muted);font-size:13px;padding-top:4px}
pre{white-space:pre-wrap;font:inherit;color:var(--ivory)}button{font:inherit;background:transparent;color:var(--gold);border:1px solid var(--gold);border-radius:6px;padding:6px 14px;cursor:pointer}
.miss{display:flex;align-items:center;justify-content:center;aspect-ratio:4/5;color:#c98b78;background:#221f1c}
@media(max-width:800px){.imgs{grid-template-columns:1fr}header,.bar,main{padding-left:16px;padding-right:16px}}");
            sb.Append("</style></head><body><header><h1>APOLOGEA</h1><p>Katalogansicht · Stand ");
            sb.Append(DateTime.Now.ToString("dd.MM.yyyy HH:mm"));
            sb.Append(" · Reine Ansicht – Bearbeitung erfolgt im Programm APOLOGEA.exe</p></header>");
            sb.Append("<div class=\"bar\"><input id=\"q\" type=\"search\" placeholder=\"Suche nach Name, Nummer, Beschreibung, Schlagwort …\"><select id=\"k\"><option value=\"\">Alle Kleidungstypen</option></select><select id=\"s\"><option value=\"n\">Nach Nummer</option><option value=\"name\">Nach Name</option></select><span id=\"count\"></span></div>");
            sb.Append("<main id=\"grid\"></main><dialog id=\"dlg\"></dialog><script>const DATA=");
            sb.Append(data);
            sb.Append(@";
const $=s=>document.querySelector(s),norm=s=>(s||'').toLocaleLowerCase('de').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ß/g,'ss');
const esc=s=>String(s??'').replace(/[&<>""]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','""':'&quot;'}[c]));
[...new Set(DATA.map(p=>p.kat))].sort((a,b)=>a.localeCompare(b,'de')).forEach(k=>{const o=document.createElement('option');o.textContent=k;$('#k').append(o)});
DATA.forEach(p=>p.hay=norm([p.n,p.nt,p.name,p.motiv,p.kat,p.serie,p.text,(p.tags||[]).join(' ')].join(' ')));
function render(){const t=norm($('#q').value).split(/\s+/).filter(Boolean),k=$('#k').value;let l=DATA.filter(p=>(!k||p.kat===k)&&t.every(x=>p.hay.includes(x)));
if($('#s').value==='name')l.sort((a,b)=>a.name.localeCompare(b.name,'de'));
$('#count').textContent=l.length+' von '+DATA.length+' Pieces';
$('#grid').innerHTML=l.map(p=>{const i=p.img[2]||p.img[0]||p.img[1];return `<div class=card data-n=""${p.n}"">${i?`<img loading=lazy src=""${i}"" alt="""">`:'<div class=miss>Kein Bild</div>'}<div class=t><div class=nr>NR. ${p.nt} · ${esc(p.kat)}</div><div class=nm>${esc(p.name)}</div><div class=sub>${esc(p.motiv)}${p.status!=='Vollständig'?' · '+p.status:''}</div></div></div>`}).join('')}
$('#grid').onclick=e=>{const c=e.target.closest('.card');if(!c)return;const p=DATA.find(x=>x.n==c.dataset.n);const L=['Designmotiv','Kleidungsansicht','Mockup'];
$('#dlg').innerHTML=`<div style=""display:flex;justify-content:space-between;gap:12px""><div><div class=nr>NR. ${p.nt} · ${esc(p.kat)}</div><h2 style=""margin:4px 0;font-family:Palatino Linotype,Georgia,serif;letter-spacing:.08em"">${esc(p.name)}</h2><div class=sub>${esc(p.motiv)} ${p.serie?'· Serie '+esc(p.serie):''}</div></div><button onclick=""this.closest('dialog').close()"">Schließen</button></div>
<div class=imgs style=""margin-top:16px"">${p.img.map((s,i)=>`<figure>${s?`<a href=""${s}"" target=_blank><img src=""${s}"" style=""${i===0?'background:repeating-conic-gradient(#3a3631 0 25%,#2a2724 0 50%) 0 0/24px 24px':''}""></a>`:'<div class=miss>Bild fehlt</div>'}<figcaption>${L[i]}</figcaption></figure>`).join('')}</div>
<pre>${esc(p.text)}</pre>${(p.tags||[]).length?'<p class=sub>Schlagwörter: '+esc(p.tags.join(', '))+'</p>':''}<p class=sub>Ordner: ${esc(p.ordner)}</p>`;$('#dlg').showModal()};
['input','change'].forEach(ev=>{$('#q').addEventListener(ev,render);$('#k').addEventListener(ev,render);$('#s').addEventListener(ev,render)});render();
</script></body></html>");
            return sb.ToString();
        }

        public static string WriteToCollection(Collection col)
        {
            string path = Path.Combine(col.Root, "Katalog_Ansicht.html");
            Util.WriteAllTextAtomic(path, Build(col));
            return path;
        }
    }
}
