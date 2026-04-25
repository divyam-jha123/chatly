import { useNavigate } from "react-router-dom";


export const SideBar = ({ chatId, setChatId }: { chatId: string, setChatId: (id: string) => void }) => {
    const navigate = useNavigate();


    return (
        <div className="h-full flex flex-col gap-2">
           <input value={chatId} placeholder="enter your room Id..." type="text" className="border border-gray-300 rounded-md p-2" onChange={(e) => {
            setChatId(e.target.value);
           }}/>
            <button className="border border-gray-300 rounded-md p-2 cursor-pointer" onClick={() => {
                navigate(`/chat/${chatId}`)
           }}>join chat</button>
        </div>
    )
}