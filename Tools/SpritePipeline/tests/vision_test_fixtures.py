from sprite_pipeline.vision_sequence import required_stages

def observed(report,count=16):
    return {**report,'reference_grip':'one_handed','observations':[{'frame':i,'holder':'reference','grip_height':'low','blade_tip':'front_low','observation':'手与刀在腰部前下方'} for i in range(1,count+1)]}

def uncertain_stages(count=16,action='attack'):
    return [{'stage':s,'status':'uncertain','confidence':.5,'observations':[{'frame':1,'observation':'本用例未对该阶段提供充分证据'}],'reason':'阶段未能确认'} for s in required_stages(action)]


def consistent_appearance(count=16):
    frames=sorted({1,max(1,count//2),count})
    return {'checked_frames':list(range(1,count+1)),'body_status':'consistent','weapon_status':'consistent','confidence':.96,
            'reference_features':'原图具有固定比例的盔甲、头盔和完整单刃剑',
            'comparisons':[{'frame':f,'observation':'头盔盔甲比例与原图对应，刀刃连接刀柄，变化来自姿势'} for f in frames],
            'findings':[]}


def consistent_grip(count=16):
    return {'status':'consistent','reference_grip':'one_handed','confidence':.97,
            'observations':[{'frame':i,'holder':'reference','confidence':.97,'observation':'持刀腕连接原图同一肩肘，另一只手没有握刀'} for i in range(1,count+1)],
            'reason':'全程由原图持刀的同一条手臂控制刀柄'}
