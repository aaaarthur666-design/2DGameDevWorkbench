"""Transparent motion cues. Pixel change is not a verdict on anatomy or force."""
import io
from PIL import Image,ImageChops,ImageStat


def measurements(frames,fps):
    images=[]
    for data in frames:
        with Image.open(io.BytesIO(data)) as source:
            rgba=source.convert('RGBA');bg=Image.new('RGBA',rgba.size,(0,0,0,255));bg.alpha_composite(rgba)
            images.append((bg.convert('RGB'),rgba.getchannel('A')))
    changes=[]
    for i,((a,aa),(b,ba)) in enumerate(zip(images,images[1:])):
        union=ImageChops.lighter(aa,ba)
        area=sum(union.histogram()[1:])
        colour=sum(ImageStat.Stat(ImageChops.difference(a,b)).sum)
        alpha=sum(ImageStat.Stat(ImageChops.difference(aa,ba)).sum)
        ratio=(colour+alpha)/(max(1,area)*4*255)
        changes.append({'from_frame':i+1,'to_frame':i+2,'visible_change':round(ratio,6),'seconds':1/fps})
    return {'adjacent_changes':changes,'possible_hold_pairs':[[x['from_frame'],x['to_frame']] for x in changes if x['visible_change']<.012],
            'interpretation':'Near-static pixel cue only. Effects and texture can change without body motion; intentional holds may be correct. Never an automatic pass, rejection, frame deletion or physics judgment.'}
