import math, json, sys
RATIO=1.2
FT=3.28084
ID={2.5:2.469,6:6.065}
EQ={6:{'elbow':14,'tee':30,'gate':3},2.5:{'tee':12}}
def hw(q,d,c=120): return 4.52*q**1.85/(c**1.85*d**4.87)
def ceil5(x): return math.ceil(x/5-1e-9)*5
floors=[('B1',-4.0),('GF',0.0)]+[('L%d'%n,round(4.5+3.6*(n-1),3)) for n in range(1,9)]
ROOF=('RF',33.3)
HV=1.2; PUMPCL=-3.9; Q=750; TOP=100; SMIN=-0.9074713796985148; SMAX=5.261289
SVC_SMAX=0.433*2.0*FT; SVC_LH=10
RISERS=[('ST-1',25,True),('ST-2',40,False)]
def outlets(roof):  # (floorId, ffl, elev) bottom->top
    o=[(f,e,e+HV) for f,e in floors]
    if roof: o.append((ROOF[0],ROOF[1],ROOF[1]+HV))
    return o
def riser_req(outs, zp, Lh, vert=False):
    down=list(reversed(outs)); k=len(down)
    q=[0]*k; 
    if k==1: q[0]=500
    else: q[0]=250;q[1]=250
    sumQ=sum(q)
    p=TOP+hw(q[0],ID[2.5])*(1+EQ[2.5]['tee']+150*2.469/12)
    cum=q[0]
    for i in range(1,k):
        dz=(down[i-1][2]-down[i][2])*FT
        p+=hw(cum,ID[6])*dz+0.433*dz; cum+=q[i]
    base=down[-1][1]
    zk=(down[-1][2]-base)*FT
    p+=hw(sumQ,ID[6])*(zk+14)+0.433*zk
    p+=hw(Q,ID[6])*(Lh*FT+(abs(base-zp)*FT if vert else 0)+61)+0.433*(base-zp)*FT
    return p
def zone_eval(i,t,station):
    kind,zp,fid=station
    reqs=[]
    for tag,Lh,roof in RISERS:
        outs=[o for o in outlets(roof)]
        # zone band by elevation of union outlet list
        lo=U[i][2]; hi=U[t][2]
        zo=[o for o in outs if lo-1e-9<=o[2]<=hi+1e-9]
        if not zo: continue
        reqs.append(riser_req(zo,zp, Lh if kind!='service-floor' else SVC_LH, kind!='pump-room'))
    req=max(reqs)
    smin= SMIN if kind!='service-floor' else 0.0
    smax= SMAX if kind!='service-floor' else SVC_SMAX
    rated=ceil5(req-smin)
    churnD=(1.2 if kind=='pump-room' else RATIO)*rated+smax
    maxStatic=churnD-0.433*(U[i][2]-zp)*FT
    ok = maxStatic<=175+1e-9 and churnD<=350+1e-9
    topRes=TOP+(rated+smin-req)
    return ok,dict(req=req,rated=rated,churnD=churnD,maxStatic=maxStatic,topRes=topRes)
U=outlets(True)  # union elevations (ST-1 has roof)
def prv_count(i,t,c):
    ok,r=zone_eval(i,t,c)
    rated=r['rated']; churnD=r['churnD']; zp=c[1]
    return sum(1 for tag,Lh,roof in RISERS for o in outlets(roof) if U[i][2]-1e-9<=o[2]<=U[t][2]+1e-9 and churnD-0.433*(o[2]-zp)*FT>175+1e-9)
def stations(i,service):
    cs=[('pump-room' if i==0 else 'express',PUMPCL,None)]
    for fid,e in floors:
        if fid in service and e<=U[i][1]+1e-9: cs.append(('service-floor',e+0.6,fid))
    return cs
def study(service):
    n=len(U); memo={}
    def best(i):
        if i==n: return ((0,0,0,0),[])
        if i in memo: return memo[i]
        opts=[]
        for c in stations(i,service):
            for t in range(i,n):
                ok,r=zone_eval(i,t,c)
                if not ok and t<n-1: continue
                pc=0 if ok else prv_count(i,t,c)
                if not ok and r['churnD']>350: pc+=1000
                sub=best(t+1)
                cost=(pc+sub[0][0], 1+sub[0][1], (1 if c[0]=='express' else 0)+sub[0][2], r['rated']+sub[0][3])
                opts.append((cost,-t,[(c,i,t,ok,r)]+sub[1]))
        opts.sort(key=lambda o:(o[0],o[1]))
        memo[i]=(opts[0][0],opts[0][2]); return memo[i]
    cost,zs=best(0)
    print('cost',cost)
    for c,i,t,ok,r in zs:
        print(c[0],c[2],U[i][0],'->',U[t][0],'req %.4f rated %d churnD %.4f maxStatic %.4f topRes %.4f'%(r['req'],r['rated'],r['churnD'],r['maxStatic'],r['topRes']),ok)
print('single zone (with PRV):',zone_eval(0,len(U)-1,('pump-room',PUMPCL,None)))
print('--- no service floors'); study(set())
print('--- service floor L4'); study({'L4'})
print('--- service floor L5,L2'); study({'L5','L2'})
print('=== TALL 30 levels')
floors=[('B1',-4.0),('GF',0.0)]+[('L%d'%n,round(4.5+3.6*(n-1),3)) for n in range(1,31)]
ROOF=('RF',round(4.5+3.6*30,3))
U=outlets(True)
print('single:',zone_eval(0,len(U)-1,('pump-room',PUMPCL,None)))
print('--- none'); study(set())
print('--- L10,L20'); study({'L10','L20'})
print('--- flat 1.1 L10,L20'); RATIO=1.1; study({'L10','L20'})
