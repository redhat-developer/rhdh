import React from 'react';

import { styled } from '@mui/material/styles';

const Svg: (props: React.ComponentProps<'svg'>) => React.ReactNode = styled(
  'svg',
)`
  width: auto;
  height: 35px;
`;

const LogoFull = (props: React.ComponentProps<'svg'>) => {
  return (
    <Svg
      viewBox="0 0 1061 340"
      xmlns="http://www.w3.org/2000/svg"
      data-name="Layer 1"
      fill="none"
      {...props}
    >
      <g clipPath="url(#clip0_1_30)">
        <path
          d="M453.123 327.617C449.072 327.617 445.538 327.299 442.52 326.664C439.501 326.108 436.88 325.433 434.656 324.639V308.555C437.119 309.349 439.621 309.945 442.162 310.342C444.704 310.818 447.563 311.057 450.74 311.057C456.141 311.057 460.51 309.548 463.846 306.529C467.182 303.511 468.85 298.031 468.85 290.088V138.422H488.627V289.611C488.627 297.554 487.356 304.345 484.815 309.984C482.273 315.703 478.381 320.072 473.139 323.09C467.897 326.108 461.225 327.617 453.123 327.617ZM467.063 102.561C467.063 98.1126 468.175 94.8561 470.399 92.791C472.702 90.6465 475.561 89.5742 478.977 89.5742C482.233 89.5742 485.013 90.6465 487.317 92.791C489.699 94.8561 490.891 98.1126 490.891 102.561C490.891 106.929 489.699 110.186 487.317 112.33C485.013 114.475 482.233 115.547 478.977 115.547C475.561 115.547 472.702 114.475 470.399 112.33C468.175 110.186 467.063 106.929 467.063 102.561ZM579.412 136.277C594.98 136.277 606.537 139.772 614.082 146.762C621.628 153.751 625.401 164.911 625.401 180.24V269H610.984L607.172 249.699H606.219C602.565 254.465 598.753 258.476 594.781 261.732C590.81 264.91 586.203 267.332 580.961 269C575.798 270.589 569.444 271.383 561.899 271.383C553.956 271.383 546.887 269.993 540.692 267.213C534.576 264.433 529.731 260.223 526.156 254.584C522.662 248.945 520.914 241.796 520.914 233.139C520.914 220.113 526.077 210.105 536.402 203.115C546.728 196.126 562.455 192.313 583.582 191.678L606.1 190.725V182.742C606.1 171.464 603.677 163.561 598.832 159.033C593.987 154.506 587.156 152.242 578.34 152.242C571.509 152.242 564.996 153.235 558.801 155.221C552.606 157.206 546.728 159.549 541.168 162.25L535.092 147.238C540.97 144.22 547.721 141.639 555.346 139.494C562.971 137.35 570.993 136.277 579.412 136.277ZM605.861 204.664L585.965 205.498C569.682 206.133 558.205 208.794 551.533 213.48C544.861 218.167 541.526 224.799 541.526 233.377C541.526 240.843 543.789 246.363 548.317 249.938C552.844 253.512 558.841 255.299 566.307 255.299C577.903 255.299 587.395 252.082 594.781 245.648C602.168 239.215 605.861 229.564 605.861 216.697V204.664ZM727.981 136.039C743.469 136.039 755.184 139.852 763.127 147.477C771.07 155.022 775.041 167.174 775.041 183.934V269H755.502V185.244C755.502 174.363 753 166.221 747.996 160.82C743.072 155.419 735.486 152.719 725.24 152.719C710.785 152.719 700.618 156.809 694.74 164.99C688.863 173.171 685.924 185.046 685.924 200.613V269H666.147V138.422H682.111L685.09 157.246H686.162C688.942 152.639 692.477 148.787 696.766 145.689C701.055 142.512 705.86 140.13 711.182 138.541C716.503 136.873 722.103 136.039 727.981 136.039ZM923.609 138.422V269H907.406L904.547 250.652H903.475C900.774 255.18 897.279 258.992 892.99 262.09C888.701 265.188 883.856 267.491 878.455 269C873.134 270.589 867.455 271.383 861.418 271.383C851.093 271.383 842.435 269.715 835.445 266.379C828.456 263.043 823.174 257.88 819.6 250.891C816.105 243.901 814.358 234.926 814.358 223.965V138.422H834.373V222.535C834.373 233.417 836.835 241.558 841.76 246.959C846.684 252.281 854.19 254.941 864.277 254.941C873.968 254.941 881.672 253.115 887.391 249.461C893.189 245.807 897.359 240.446 899.901 233.377C902.442 226.229 903.713 217.492 903.713 207.166V138.422H923.609ZM1049.9 233.258C1049.9 241.598 1047.79 248.627 1043.58 254.346C1039.45 259.985 1033.5 264.234 1025.71 267.094C1018.01 269.953 1008.8 271.383 998.072 271.383C988.938 271.383 981.035 270.668 974.363 269.238C967.692 267.809 961.854 265.783 956.85 263.162V244.934C962.171 247.555 968.526 249.938 975.912 252.082C983.299 254.227 990.845 255.299 998.549 255.299C1009.83 255.299 1018.01 253.472 1023.09 249.818C1028.18 246.165 1030.72 241.201 1030.72 234.926C1030.72 231.352 1029.68 228.214 1027.62 225.514C1025.63 222.734 1022.26 220.073 1017.49 217.531C1012.73 214.91 1006.13 212.051 997.715 208.953C989.375 205.776 982.147 202.639 976.031 199.541C969.995 196.364 965.309 192.512 961.973 187.984C958.716 183.457 957.088 177.579 957.088 170.352C957.088 159.311 961.536 150.852 970.432 144.975C979.407 139.018 991.162 136.039 1005.7 136.039C1013.56 136.039 1020.91 136.833 1027.74 138.422C1034.65 139.931 1041.08 141.996 1047.04 144.617L1040.37 160.463C1034.97 158.16 1029.21 156.214 1023.09 154.625C1016.98 153.036 1010.74 152.242 1004.39 152.242C995.253 152.242 988.223 153.751 983.299 156.77C978.454 159.788 976.031 163.918 976.031 169.16C976.031 173.211 977.143 176.547 979.367 179.168C981.671 181.789 985.324 184.251 990.328 186.555C995.332 188.858 1001.92 191.559 1010.11 194.656C1018.29 197.674 1025.36 200.812 1031.31 204.068C1037.27 207.245 1041.84 211.137 1045.01 215.744C1048.27 220.271 1049.9 226.109 1049.9 233.258Z"
          fill="#009596"
        />
        <path
          d="M334.669 150.973V165.548C321.583 165.548 312.414 168.291 307.164 173.776C301.992 179.262 299.406 188.43 299.406 201.281V238.895C299.406 249.709 298.348 259.073 296.233 266.988C294.195 274.902 290.826 281.445 286.124 286.617C281.422 291.789 275.153 295.629 267.317 298.136C259.481 300.644 249.803 301.898 238.284 301.898V278.859C247.374 278.859 254.505 277.41 259.677 274.51C264.927 271.689 268.61 267.34 270.726 261.463C272.92 255.586 274.017 248.063 274.017 238.895V191.878C274.017 185.766 274.801 180.202 276.368 175.187C278.014 170.172 280.991 165.862 285.301 162.257C289.611 158.652 295.723 155.871 303.638 153.912C311.631 151.953 321.974 150.973 334.669 150.973ZM238.284 0.98862C249.803 0.98862 259.481 2.24241 267.317 4.75C275.153 7.25757 281.422 11.0973 286.124 16.2692C290.826 21.441 294.195 27.9842 296.233 35.8988C298.348 43.8133 299.406 53.1775 299.406 63.9915V101.605C299.406 114.456 301.992 123.625 307.164 129.11C312.414 134.595 321.583 137.338 334.669 137.338V151.913C321.974 151.913 311.631 150.934 303.638 148.975C295.723 147.016 289.611 144.234 285.301 140.629C280.991 137.025 278.014 132.715 276.368 127.7C274.801 122.684 274.017 117.121 274.017 111.009V63.9915C274.017 54.8231 272.92 47.3004 270.726 41.4233C268.61 35.4678 264.927 31.0795 259.677 28.2585C254.505 25.4375 247.374 24.027 238.284 24.027V0.98862ZM334.669 137.338V165.548H306.929V137.338H334.669Z"
          fill="#009596"
        />
        <path
          d="M0.751879 188.725L0.798706 174.15C13.885 174.192 23.0621 171.479 28.33 166.011C33.5194 160.542 36.1348 151.382 36.1761 138.531L36.297 100.917C36.3317 90.1034 37.4197 80.7427 39.5608 72.835C41.6237 64.927 45.0142 58.3947 49.7325 53.2379C54.4508 48.0812 60.7321 44.2616 68.5763 41.7792C76.4204 39.2968 86.1021 38.0742 97.6212 38.1112L97.5472 61.1494C88.4573 61.1202 81.3217 62.547 76.1406 65.4297C70.8813 68.2339 67.1844 72.5711 65.0497 78.4414C62.8367 84.3114 61.7155 91.8306 61.686 100.999L61.535 148.016C61.5153 154.128 60.7139 159.689 59.1305 164.699C57.4688 169.709 54.4772 174.009 50.1558 177.6C45.8343 181.191 39.7132 183.953 31.7924 185.887C23.7933 187.82 13.4464 188.766 0.751879 188.725ZM96.6545 339.019C85.1353 338.982 75.4617 337.697 67.6337 335.164C59.8056 332.631 53.549 328.772 48.864 323.585C44.1789 318.398 40.8304 311.844 38.8184 303.923C36.7281 296.001 35.7003 286.634 35.735 275.82L35.8559 238.206C35.8972 225.355 33.3407 216.179 28.1865 210.677C22.9539 205.174 13.7944 202.402 0.708073 202.36L0.7549 187.785C13.4494 187.826 23.79 188.839 31.7766 190.823C39.6847 192.808 45.788 195.609 50.0863 199.228C54.3846 202.846 57.3485 207.166 58.9779 212.186C60.5291 217.206 61.2948 222.772 61.2752 228.885L61.1241 275.901C61.0946 285.07 62.1675 292.596 64.3428 298.48C66.4394 304.442 70.1083 308.842 75.3494 311.68C80.5122 314.518 87.6386 315.951 96.7285 315.98L96.6545 339.019ZM0.708073 202.36L0.798706 174.15L28.5386 174.239L28.448 202.449L0.708073 202.36Z"
          fill="#009596"
        />
        <path d="M97.0001 87V290H241" stroke="#009596" strokeWidth="24" />
        <path
          d="M238.214 253.462L238.867 50.4627L94.8674 50.0001"
          stroke="#009596"
          strokeWidth="24"
        />
        <path
          d="M240.977 327.471L88.9774 326.983"
          stroke="#009596"
          strokeWidth="24"
        />
      </g>
      <defs>
        <clipPath id="clip0_1_30">
          <rect width="1061" height="340" fill="white" />
        </clipPath>
      </defs>
    </Svg>
  );
};

export default LogoFull;
