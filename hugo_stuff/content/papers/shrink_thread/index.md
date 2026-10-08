---
title: "Fabricating 3D Shapes by Shrinking-Thread Embroidery" 
date: 2026-10-01
tags: ["Embroidery", "Shrinking thread", "Inverse design"]
author: ["Annika Oehri", "Aviv Segall", "Amir Vaxman", "Olga Sorkine-Hornung"]
description: "" 
summary: "The paper presents a method that takes a target 3D shape and generates a flat embroidery stitching pattern with heat-shrinkable polyester threads. When heated, the threads shrink and the fabric contracts into the target 3D shape.
" 
cover:
    image: "shrink_thread.jpg"
    alt: ""
    relative: false
editPost:
    URL: "https://dl.acm.org/journal/tog"
    Text: "ACM Transactions on Graphics"

---

---

#####
 
![](fabrications.png#center)

---

##### Abstract

We propose a computational method that repurposes embroidery as a tool for 3D fabrication. Given an input mesh, our method computes a freeform stitching pattern, such that an embroidered flat fabric approximates the target geometry. The stitching is done with polyester threads that permanently shrink when heat is applied, thereby generating curvature. Our approach is based on vector field optimization: we jointly optimize a shrinking field over the mesh surface and a corresponding planar parameterization that also allows for seams to arise in order to achieve higher curvatures than through shrinkage alone. Our energy formulation balances fabrication adherence, field smoothness, stitch consistency and validity of stretch values, and is minimized via an alternating algorithm. We demonstrate our method on a variety of target shapes and validate our results through both a digital preview tool and physical fabrication.

---

##### Download

+ [Paper](shrink_thread_embroidery.pdf)
+ [Video](https://www.youtube.com/watch?v=YITb_IvgJtI)
+ [Code and data](https://github.com/oehria/3d-embroidery)
---

##### Citation

```BibTeX
@inproceedings{3dEmbroidery:2026,
author = {Oehri, Annika and Segall, Aviv and Vaxman, Amir and Sorkine-Hornung, Olga},
title={Fabricating 3D Shapes by Shrinking-Thread Embroidery},
year = {2026},
isbn = {979-8-4007-2842-6/26/12},
publisher = {Association for Computing Machinery},
address = {New York, NY, USA},
url = {https://doi.org/10.1145/3829340.3842253},
doi = {https://doi.org/10.1145/3829340.3842253},
booktitle = {SIGGRAPH Asia Conference Papers '26},
location = {Kuala Lumpur, Malaysia},
series = {SIGGRAPH Asia Conference Papers '26},
}
```

---

<!-- ##### Related material

+ [Presentation slides](presentation2.pdf)
 -->
