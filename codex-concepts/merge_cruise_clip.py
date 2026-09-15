"""Pack Blender's per-object tracks into one synchronized glTF cruising clip."""
import json, struct
from pathlib import Path

def merge_cruise_clip(path):
    path=Path(path); raw=path.read_bytes()
    size,kind=struct.unpack_from('<II',raw,12)
    document=json.loads(raw[20:20+size]); animations=document.get('animations',[])
    if not animations: raise ValueError('Missing cruising tracks')
    merged={'name':'Cruise_Wind','channels':[],'samplers':[]}; seen=set()
    for animation in animations:
        offset=len(merged['samplers']); merged['samplers'].extend(animation['samplers'])
        for channel in animation['channels']:
            key=(channel['target']['node'],channel['target']['path'])
            if key in seen: raise ValueError('Duplicate animation target: '+str(key))
            seen.add(key)
            merged['channels'].append(dict(channel,sampler=channel['sampler']+offset))
    document['animations']=[merged]
    encoded=json.dumps(document,separators=(',',':')).encode()
    encoded+=b' '*((-len(encoded))%4)
    remaining=raw[20+size:]
    path.write_bytes(struct.pack('<III',0x46546C67,2,20+len(encoded)+len(remaining))+
        struct.pack('<II',len(encoded),kind)+encoded+remaining)

if __name__=='__main__':
    for name in ['fox-detailed.glb','fox-detailed-rider.glb']:
        merge_cruise_clip(Path(__file__).resolve().parent/name)
