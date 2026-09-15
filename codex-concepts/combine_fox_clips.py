"""Copy animation accessor data by node name; preserve the target asset's geometry and skins."""
import json,struct,copy
from pathlib import Path

def load(path):
    raw=Path(path).read_bytes(); n=struct.unpack_from('<I',raw,12)[0]
    return json.loads(raw[20:20+n]),bytearray(raw[28+n:])

def combine_fox_clips(target,source):
    dst,blob=load(target); src,source_blob=load(source)
    dst['animations'][0]['name']='Stream_Tag_Backflip'
    names={n.get('name'):i for i,n in enumerate(dst['nodes'])}
    assert len(names)==len(dst['nodes']), 'Animation merge requires unique node names'
    # Append only animation data; copy all referenced bufferViews with corrected offsets.
    cache={}; view_cache={}
    def accessor(index):
        if index in cache: return cache[index]
        a=copy.deepcopy(src['accessors'][index]); view_id=a['bufferView']
        if view_id not in view_cache:
            view=copy.deepcopy(src['bufferViews'][view_id]); offset=view.get('byteOffset',0); length=view['byteLength']
            blob.extend(b'\0'*((-len(blob))%4)); view['byteOffset']=len(blob); view['buffer']=0
            blob.extend(source_blob[offset:offset+length])
            view_cache[view_id]=len(dst['bufferViews']); dst['bufferViews'].append(view)
        a['bufferView']=view_cache[view_id]; cache[index]=len(dst['accessors']); dst['accessors'].append(a)
        return cache[index]
    run=copy.deepcopy(next(a for a in src['animations'] if a['name']=='Run_On_Orb'))
    for sampler in run['samplers']:
        sampler['input']=accessor(sampler['input']); sampler['output']=accessor(sampler['output'])
    for channel in run['channels']:
        name=src['nodes'][channel['target']['node']]['name']; channel['target']['node']=names[name]
    dst['animations'].append(run); dst['buffers'][0]['byteLength']=len(blob)
    encoded=json.dumps(dst,separators=(',',':')).encode(); encoded+=b' '*((-len(encoded))%4)
    blob.extend(b'\0'*((-len(blob))%4))
    Path(target).write_bytes(struct.pack('<III',0x46546C67,2,28+len(encoded)+len(blob))+
        struct.pack('<II',len(encoded),0x4E4F534A)+encoded+struct.pack('<II',len(blob),0x004E4942)+blob)
