import re, os, sys, glob
sys.stdout.reconfigure(encoding='utf-8')
pat = re.compile(r'\b[A-Z]{3}\d{7}\b')
# also capture RJ/xx/xxx/xxxxxx
rj = re.compile(r'RJ/\d{2}/\d{3}/\d{6}')
for f in sorted(glob.glob('scratchpad/newward/supp_w*.tsv')):
    toks = set()
    text = open(f, encoding='utf-8').read()
    for m in pat.finditer(text):
        toks.add(m.group(0))
    for m in rj.finditer(text):
        toks.add(m.group(0))
    print(f'{os.path.basename(f)}: {len(toks)} epic tokens -> {sorted(toks)}')
