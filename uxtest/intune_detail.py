import json, sys, re, numpy as np
from collections import defaultdict
import os
BASE = os.path.dirname(os.path.abspath(__file__))
N={'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11}
def et(n):
    m=re.match(r'([A-G])(#?)(\d)',n); return 440*2**(((int(m.group(3))+1)*12+N[m.group(1)]+(1 if m.group(2) else 0)-69)/12)
for name in sys.argv[1:]:
    meta=json.load(open(f'{BASE}/www/sessions/{name}.json')); fr=json.load(open(f'{BASE}/logs/off_{name}.json'))['frames']; tl=meta['timeline']
    per=defaultdict(lambda: {'in_ok':0,'in_n':0,'false':0,'bias':[], 'false_where':defaultdict(int)})
    for f in fr:
        j=int(round(f[0]/0.01));
        if j>=len(tl): continue
        t,ftrue,s,kind,snr=tl[j]
        if not ftrue or not s or snr<6: continue
        tc=1200*np.log2(ftrue/et(s)); live=f[2]=='active' and not f[3] and f[5]==s
        d=per[s]
        if kind=='in-tune-confirm' and abs(tc)<=2:
            d['in_n']+=1; d['in_ok']+= 1 if f[4] else 0
            if live: d['bias'].append(f[8]-tc)
        if f[4] and abs(tc)>5: d['false']+=1; d['false_where'][kind]+=1
    print(name)
    for s,d in per.items():
        b=np.median(d['bias']) if d['bias'] else float('nan')
        print(f"  {s}: in-tune shown {100*d['in_ok']/max(1,d['in_n']):.0f}%  reading bias {b:+.1f}c  false-in {d['false']} {dict(d['false_where'])}")
